import { useState } from "react";
import type { AuditFlow } from "../useAuditFlow";
import { auditApiBase } from "../api";
import { shellArgument } from "../cliHandoff";

const HASH = /^[0-9a-f]{64}$/;

// PAY is permission to ask the wallet for a signature, never permission to
// spend automatically. CLI and manual settlement verification remain available
// for wallets that do not support Casper EIP-712 typed data.
export function SigningHandoff({ flow }: { flow: AuditFlow }) {
  const [txHash, setTxHash] = useState("");
  const isPay = flow.decision === "pay";
  const url = flow.probe.data?.request.url ?? "<service-url>";
  const method = flow.probe.data?.request.method ?? "GET";
  const valid = HASH.test(txHash.trim().toLowerCase());
  const walletBusy = flow.walletPayment.status === "running" || flow.settlement.status === "running";
  const walletPaid = flow.walletPayment.status === "success";

  const command = [
    `agentpay call \\`,
    `  --url ${shellArgument(url)} \\`,
    `  --method ${shellArgument(method)} \\`,
    `  --key ${shellArgument("<buyer-key.pem>")} \\`,
    `  --token ${shellArgument("<agent-token>")} \\`,
    `  --api-url ${shellArgument(auditApiBase)}`
  ].join("\n");

  return (
    <section className="audit-section" aria-label="Signing handoff" data-step-state={isPay ? "pay" : "idle"}>
      <div className="audit-section-head">
        <h2>Pay the checked charge</h2>
        <span className="audit-tag" data-state={isPay ? "pay" : "idle"}>
          {isPay ? "ready for wallet" : "not ready"}
        </span>
      </div>

      {!isPay ? (
        <p className="audit-note">The signing handoff opens once the decision is PAY.</p>
      ) : (
        <>
          <p className="audit-note">
            Casper Wallet will show the exact token amount and recipient. Nothing is sent until you approve it there.
          </p>
          <div className="audit-actions">
            <button
              className="audit-button"
              type="button"
              disabled={walletBusy || walletPaid}
              onClick={() => void flow.payWithWallet()}
            >
              {flow.walletPayment.status === "running"
                ? "Waiting for Casper Wallet…"
                : flow.settlement.status === "running"
                  ? "Verifying on Casper…"
                  : walletPaid
                    ? "Payment sent"
                    : "Pay with Casper Wallet"}
            </button>
          </div>

          {flow.walletPayment.error ? (
            <p className="audit-note" data-state="error" role="alert">
              {flow.walletPayment.error.message}
            </p>
          ) : null}
          {flow.walletPayment.data ? (
            <p className="audit-note" data-state="success">
              Payment sent. Casper transaction: <code>{flow.walletPayment.data.transactionHash}</code>
            </p>
          ) : null}

          <details className="audit-disclosure">
            <summary className="audit-note">Use the AgentPay CLI</summary>
            <pre className="audit-code-block audit-scroll-x">{command}</pre>
            <form
              className="audit-actions"
              onSubmit={(event) => {
                event.preventDefault();
                if (valid) void flow.verifySettlement(txHash.trim().toLowerCase());
              }}
            >
              <input
                className="audit-input audit-mono"
                aria-label="Casper transaction hash"
                placeholder="64-character Casper transaction hash"
                value={txHash}
                onChange={(event) => setTxHash(event.target.value)}
              />
              <button className="audit-button" type="submit" disabled={!valid || flow.settlement.status === "running"}>
                {flow.settlement.status === "running" ? "Verifying…" : "Verify settlement"}
              </button>
            </form>
            {txHash.trim() && !valid ? (
              <p className="audit-note" data-state="error">
                A Casper transaction hash is 64 hexadecimal characters.
              </p>
            ) : null}
          </details>
        </>
      )}
    </section>
  );
}
