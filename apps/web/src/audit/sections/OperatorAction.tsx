import { useState } from "react";
import type { AuditFlow } from "../useAuditFlow";
import { auditApiBase } from "../api";
import { shellArgument } from "../cliHandoff";
import { HashValue, StepStatusLine } from "./primitives";

const RULE_DURATIONS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" }
] as const;

export function OperatorAction({ flow }: { flow: AuditFlow }) {
  const [cliKind, setCliKind] = useState<"pin" | "deny">("pin");
  const [durationDays, setDurationDays] = useState(30);
  const check = flow.check.data?.check;
  const isReview = flow.decision === "review";
  const walletConnected = flow.walletSession.status === "success";

  const origin = check?.request.origin ?? "<origin>";
  const path = check?.request.path ?? "/";
  const payee = check?.terms.payTo ?? "<payee>";
  const asset = check?.terms.asset ?? "<asset-hash>";
  const ceiling = check?.terms.amount ?? "<amount>";
  const promptedBy = check?.id ?? "<check-id>";
  const relevantDecisions = flow.providerDecisions.data?.filter((decision) =>
    decision.origin === origin &&
    decision.payee.toLowerCase() === payee.toLowerCase() &&
    decision.asset.toLowerCase().replace(/^hash-/, "") === asset.toLowerCase().replace(/^hash-/, "") &&
    decision.network === check?.terms.network &&
    (decision.resourcePathPrefix === null || path.startsWith(decision.resourcePathPrefix))
  );

  const command = [
    `agentpay provider ${cliKind} \\`,
    `  --origin ${shellArgument(origin)} \\`,
    `  --path-prefix ${shellArgument(path)} \\`,
    `  --payee ${shellArgument(payee)} \\`,
    `  --asset ${shellArgument(asset)} \\`,
    `  --ceiling ${shellArgument(ceiling)} \\`,
    `  --expires-in ${durationDays * 24 * 60 * 60} \\`,
    `  --prompted-by-check ${shellArgument(promptedBy)} \\`,
    `  --key ${shellArgument("<operator-key.pem>")} \\`,
    `  --session-token ${shellArgument("<operator-session-token>")} \\`,
    `  --api-url ${shellArgument(auditApiBase)}`
  ].join("\n");

  return (
    <section className="audit-section" aria-label="Operator action" data-step-state={isReview ? "review" : "idle"}>
      <div className="audit-section-head">
        <h2>Choose what AgentPay should do</h2>
        <span className="audit-tag" data-state={isReview ? "review" : "idle"}>
          {isReview ? "needs your choice" : "not needed"}
        </span>
      </div>

      {!isReview ? (
        <p className="audit-note">This check does not need a provider decision.</p>
      ) : (
        <>
          <p className="audit-note">
            This rule applies only to the payment service, path, recipient, token, network, and maximum amount shown below.
          </p>

          <dl className="audit-field-grid">
            <dt>service</dt>
            <dd>{origin}</dd>
            <dt>path</dt>
            <dd className="audit-mono">{path}</dd>
            <dt>maximum per call</dt>
            <dd className="audit-mono">{ceiling}</dd>
          </dl>

          <label className="audit-control-label" htmlFor="provider-rule-duration">
            Keep this rule active for
          </label>
          <select
            id="provider-rule-duration"
            className="audit-input"
            value={durationDays}
            onChange={(event) => setDurationDays(Number(event.target.value))}
          >
            {RULE_DURATIONS.map((duration) => (
              <option key={duration.days} value={duration.days}>{duration.label}</option>
            ))}
          </select>

          {walletConnected ? (
            <>
              <p className="audit-note">
                Casper Wallet will ask you to sign this rule. Signing the rule does not send CSPR or make a payment.
              </p>
              <div className="audit-actions">
                <button
                  className="audit-button"
                  data-action="primary"
                  type="button"
                  disabled={flow.providerAction.status === "running"}
                  onClick={() => void flow.saveProviderRule("pin", durationDays)}
                >
                  Approve this provider
                </button>
                <button
                  className="audit-button"
                  data-action="danger"
                  type="button"
                  disabled={flow.providerAction.status === "running"}
                  onClick={() => void flow.saveProviderRule("deny", durationDays)}
                >
                  Block this provider
                </button>
              </div>
              <StepStatusLine
                status={flow.providerAction.status}
                error={flow.providerAction.error}
                emptyLabel="Your choice will be saved as a signed Casper account rule."
              />
              {flow.providerAction.status === "success" && flow.providerAction.data ? (
                <p className="audit-note" role="status" data-state="success">
                  {flow.providerAction.data.kind === "pin" ? "Provider approved" : "Provider blocked"}. Run the check again to apply this rule and see what remains.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="audit-note">
                This session uses an AgentPay token, so the provider rule must be signed on your machine.
              </p>
              <div className="audit-actions" role="group" aria-label="CLI provider choice">
                <label className="audit-note">
                  <input type="radio" name="operator-kind" checked={cliKind === "pin"} onChange={() => setCliKind("pin")} /> Approve
                </label>
                <label className="audit-note">
                  <input type="radio" name="operator-kind" checked={cliKind === "deny"} onChange={() => setCliKind("deny")} /> Block
                </label>
              </div>
              <details className="audit-disclosure">
                <summary>Use the AgentPay CLI</summary>
                <pre className="audit-code-block audit-scroll-x">{command}</pre>
              </details>
            </>
          )}

          <div className="audit-actions">
            <button className="audit-button" type="button" onClick={() => void flow.loadProviderDecisions()}>
              View rules for this service
            </button>
            <button className="audit-button" type="button" onClick={() => void flow.recheck()}>
              Run the check again
            </button>
          </div>

          <StepStatusLine
            status={flow.providerDecisions.status}
            error={flow.providerDecisions.error}
            emptyLabel="Saved provider rules appear here when requested."
          />

          {relevantDecisions && relevantDecisions.length > 0 ? (
            <ul className="audit-reasons" aria-label="Rules for this payment service">
              {relevantDecisions.map((decision) => (
                <li key={decision.decisionId} className="audit-reason" data-kind={decision.kind}>
                  <strong>
                    {decision.kind === "pin" ? "APPROVED" : "BLOCKED"} · {decision.origin}
                  </strong>
                  <span className="audit-mono">
                    maximum {decision.perCallCeiling} · expires {decision.expiresAt}
                  </span>
                  <HashValue value={decision.decisionHash} />
                </li>
              ))}
            </ul>
          ) : flow.providerDecisions.status === "success" ? (
            <p className="audit-note" data-state="not_checked">No saved rules match this payment service.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
