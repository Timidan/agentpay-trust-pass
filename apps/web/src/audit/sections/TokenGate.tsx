import { Wallet } from "@phosphor-icons/react";
import { useState } from "react";
import type { AuditFlow } from "../useAuditFlow";
import { ApiErrorView } from "./primitives";

// People sign an origin-bound login challenge in Casper Wallet. Agents and CLI
// users can still paste a scoped token. Both paths store only the resulting
// short-lived credential in memory; no key or token is persisted or rendered.
export function TokenGate({ flow }: { flow: AuditFlow }) {
  const [draft, setDraft] = useState("");
  return (
    <section className="audit-section" aria-label="Authentication" data-step-state={flow.tokenPresent ? "success" : "idle"}>
      <div className="audit-section-head">
        <h2>Connect</h2>
        <span className="audit-tag" data-state={flow.tokenPresent ? "success" : "idle"}>
          {flow.tokenPresent ? "access ready" : "not connected"}
        </span>
      </div>
      {flow.walletSession.status === "success" ? (
        <p className="audit-note" data-state="success">
          Casper Wallet connected. Your session stays in this tab.
        </p>
      ) : (
        <>
          <p className="audit-note">
            Connect Casper Wallet and sign a login message to use your payment rules. This does not send a transaction,
            and AgentPay never receives your private key.
          </p>
          <div className="audit-actions">
            <button
              className="audit-button"
              type="button"
              disabled={flow.walletSession.status === "running"}
              onClick={() => void flow.connectWallet()}
            >
              <Wallet size={16} weight="bold" aria-hidden="true" />
              {flow.walletSession.status === "running" ? "Waiting for Casper Wallet…" : "Connect Casper Wallet"}
            </button>
          </div>
        </>
      )}

      {flow.walletSession.status === "error" && flow.walletSession.error ? (
        <ApiErrorView error={flow.walletSession.error} />
      ) : null}

      {flow.tokenPresent ? (
        <div className="audit-actions">
          <button className="audit-button" type="button" onClick={() => flow.signOut()}>
            End session
          </button>
        </div>
      ) : null}

      <details className="audit-disclosure">
        <summary className="audit-note">Use an AgentPay token instead</summary>
        <p className="audit-note">
          Agents and developers can paste an operator session or scoped agent token. It stays in memory for this tab.
          Never paste a private key.
        </p>
        <form
          className="audit-actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) {
              flow.setToken(draft.trim());
              setDraft("");
            }
          }}
        >
          <input
            className="audit-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="AgentPay token"
            placeholder="AgentPay token"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="audit-button" type="submit" disabled={!draft.trim()}>
            Use token
          </button>
        </form>
      </details>
    </section>
  );
}
