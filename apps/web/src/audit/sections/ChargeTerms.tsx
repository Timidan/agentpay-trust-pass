import { Lightning } from "@phosphor-icons/react";
import type { AuditFlow } from "../useAuditFlow";
import { formatAtomicAmount } from "../paymentAmounts";
import { CopyField, HashValue, StepStatusLine } from "./primitives";

// The captured x402 charge with copyable fields. This section also prepares the
// unsigned payment details that a PAY decision requires; it never handles keys.
export function ChargeTerms({ flow }: { flow: AuditFlow }) {
  const probe = flow.probe;
  const result = probe.data;
  const terms = result?.terms ?? null;

  return (
    <section className="audit-section" aria-label="Charge terms" data-step-state={probe.status}>
      <div className="audit-section-head">
        <h2>Charge</h2>
        <span className="audit-tag" data-state={probe.status}>
          charge {plainStatus(probe.status)}
        </span>
      </div>

      <form
        className="audit-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void flow.runProbe();
        }}
      >
        <button
          className="audit-button"
          type="button"
          disabled={flow.liveService.status === "running"}
          onClick={() => void flow.loadAgentPayService()}
        >
          <Lightning size={15} weight="bold" aria-hidden="true" />
          {flow.liveService.status === "running"
            ? "Getting a fresh charge…"
            : "Use AgentPay's own charge"}
        </button>
        <input
          className="audit-input"
          type="url"
          inputMode="url"
          aria-label="Service URL"
          placeholder="Paste an HTTPS x402 service URL"
          value={flow.probeInput.url}
          onChange={(event) => flow.setProbeInput({ url: event.target.value })}
        />
        <select
          className="audit-input"
          aria-label="HTTP method"
          value={flow.probeInput.method ?? "GET"}
          onChange={(event) => flow.setProbeInput({ method: event.target.value === "POST" ? "POST" : "GET" })}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
        <button
          className="audit-button"
          type="submit"
          disabled={probe.status === "running" || !flow.probeInput.url.trim()}
        >
          {probe.status === "running" ? "Reading…" : "Read charge"}
        </button>
      </form>

      {flow.liveService.status === "success" ? (
        <p className="audit-note" data-state="success">
          Loaded a real AgentPay token-check charge using official WCSPR. It settles on Casper Testnet.
        </p>
      ) : null}
      {flow.liveService.status === "error" ? (
        <StepStatusLine status="error" error={flow.liveService.error} emptyLabel="" />
      ) : null}

      <StepStatusLine
        status={probe.status}
        error={probe.error}
        emptyLabel={
          flow.tokenPresent
            ? "Enter a service URL, then read its x402 charge."
            : "Connect Casper Wallet or enter an AgentPay token before reading a charge."
        }
      />

      {result && !terms ? (
        <p className="audit-note" data-state="not_checked">
          This service did not return a supported Casper payment request. It answered HTTP {result.response.status};
          AgentPay needs a 402 response with one Casper x402 v2 payment option.
        </p>
      ) : null}

      {terms ? (
        <>
          <dl className="audit-field-grid">
            <dt>Network</dt>
            <dd className="audit-mono">{terms.network}</dd>
            <dt>Amount</dt>
            <dd className="audit-mono">
              {terms.extra.decimals === null
                ? terms.amount
                : formatAtomicAmount(terms.amount, terms.extra.decimals)}
              {terms.extra.symbol ? ` ${terms.extra.symbol}` : ""}
            </dd>
            <dt>Exact on-chain amount</dt>
            <dd className="audit-mono">{terms.amount} smallest units</dd>
            <CopyField label="Token contract" value={terms.asset} />
            <CopyField label="Payment destination" value={terms.payTo} />
            <dt>Token</dt>
            <dd className="audit-mono">
              {terms.extra.name} v{terms.extra.version}
            </dd>
            <dt>Payment window</dt>
            <dd className="audit-mono">{terms.maxTimeoutSeconds}s</dd>
            <dt>Paid resource</dt>
            <dd className="audit-mono">{terms.resource.url}</dd>
            <CopyField label="Charge ID" value={terms.requirementHash} />
          </dl>

          {result ? (
            <dl className="audit-field-grid">
              <dt>Original request</dt>
              <dd className="audit-mono">
                {result.request.method} {result.request.url}
              </dd>
              <CopyField label="Request ID" value={result.request.requestHash} />
            </dl>
          ) : null}

          {result && result.advisories.length > 0 ? (
            <ul className="audit-reasons" aria-label="Advisories">
              {result.advisories.map((reason, index) => (
                <li key={`${reason.code}-${index}`} className="audit-reason" data-result={reason.result}>
                  <strong>{reason.message}</strong>
                  <span className="audit-mono">[{reason.code}]</span>
                </li>
              ))}
            </ul>
          ) : null}

          {flow.walletSession.status === "success" ? (
            <div className="audit-preparation">
              <p className="audit-note">
                Prepare the exact payer, recipient, amount, token, and short validity window for AgentPay to check.
                This does not sign or send the payment.
              </p>
              <div className="audit-actions">
                <button
                  className="audit-button"
                  data-action="primary"
                  type="button"
                  disabled={flow.authorization.status === "running"}
                  onClick={() => void flow.preparePaymentDetails()}
                >
                  {flow.authorization.status === "success" ? "Prepare new payment details" : "Prepare payment details"}
                </button>
              </div>
              <StepStatusLine
                status={flow.authorization.status}
                error={flow.authorization.error}
                emptyLabel="Payment details are prepared locally from this live charge."
              />
              {flow.authorization.status === "success" && flow.authorization.data ? (
                <p className="audit-note" role="status" data-state="success">
                  Payment details ready. Run the check before they expire; your wallet has not signed anything yet.
                </p>
              ) : null}
            </div>
          ) : null}

          <details>
            <summary className="audit-note">Paste prepared payment details (advanced)</summary>
            <p className="audit-note">
              A PAY decision needs a complete transfer authorization draft that matches this charge. Paste a draft
              created by your wallet or CLI; never paste a private key.
            </p>
            <textarea
              className="audit-textarea"
              aria-label="Authorization intent JSON"
              spellCheck={false}
              placeholder='{"payerPublicKey":"01…","digest":"…", …}'
              value={flow.authorizationText}
              onChange={(event) => flow.setAuthorizationText(event.target.value)}
            />
          </details>
        </>
      ) : null}
    </section>
  );
}

function plainStatus(status: "idle" | "running" | "success" | "error"): string {
  if (status === "success") return "ready";
  if (status === "running") return "reading";
  if (status === "error") return "needs attention";
  return "not read";
}
