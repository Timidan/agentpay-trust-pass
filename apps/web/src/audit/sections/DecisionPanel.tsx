import type { AuditFlow } from "../useAuditFlow";
import type { Reason } from "../api";
import { HashValue, StepStatusLine } from "./primitives";

// Keeps rerun controls and machine-readable decision fields available. The
// decision hero carries the plain-language result; raw IDs and codes stay in an
// explicit disclosure so they do not compete with the next action.
export function DecisionPanel({ flow }: { flow: AuditFlow }) {
  const check = flow.check;
  const decision = check.data?.check.decision ?? null;
  const verdict = flow.decision;
  const hasCharge = Boolean(flow.probe.data?.terms);

  return (
    <section className="audit-section" aria-label="Decision" data-step-state={check.status} data-decision={verdict ?? "none"}>
      <div className="audit-section-head">
        <h2>Decision</h2>
        {verdict ? (
          <span className="audit-tag" data-decision={verdict}>
            {verdict.toUpperCase()}
          </span>
        ) : null}
      </div>

      <div className="audit-actions">
        <button
          className="audit-button"
          type="button"
          disabled={!hasCharge || check.status === "running"}
          onClick={() => void (decision ? flow.recheck() : flow.runCheck())}
        >
          {check.status === "running" ? "Checking…" : decision ? "Run check again" : "Run check"}
        </button>
      </div>

      <StepStatusLine
        status={check.status}
        error={check.error}
        emptyLabel={hasCharge ? "Run a check to get a PAY, REVIEW, or BLOCK decision." : "Read a charge first."}
      />

      {decision ? (
        <>
          {decision.advisories.length > 0 ? (
            <ReasonList label="Warnings" reasons={decision.advisories} showTechnicalDetails={false} />
          ) : null}
          <details className="audit-disclosure">
            <summary className="audit-note">View technical details</summary>
            <dl className="audit-field-grid">
              {flow.idempotencyKey ? (
                <>
                  <dt>request ID</dt>
                  <dd>
                    <HashValue value={flow.idempotencyKey} />
                  </dd>
                </>
              ) : null}
              <dt>decision source</dt>
              <dd className="audit-mono">{decision.basis ?? "not supplied"}</dd>
              {decision.policyHash ? (
                <>
                  <dt>rules ID</dt>
                  <dd>
                    <HashValue value={decision.policyHash} />
                  </dd>
                </>
              ) : null}
              {decision.authorizationDigest ? (
                <>
                  <dt>signed approval ID</dt>
                  <dd>
                    <HashValue value={decision.authorizationDigest} />
                  </dd>
                </>
              ) : null}
              {decision.reservation ? (
                <>
                  <dt>reserved spend</dt>
                  <dd className="audit-mono">
                    {decision.reservation.amount} · expires {decision.reservation.expiresAt}
                  </dd>
                </>
              ) : null}
            </dl>
            <ReasonList
              label="Technical decision reasons"
              reasons={decision.reasons}
              emptyLabel="No blocking or review reasons."
            />
          </details>
        </>
      ) : null}
    </section>
  );
}

export function ReasonList({
  label,
  reasons,
  emptyLabel,
  showTechnicalDetails = true
}: {
  label: string;
  reasons: Reason[];
  emptyLabel?: string;
  showTechnicalDetails?: boolean;
}) {
  if (reasons.length === 0) {
    return emptyLabel ? <p className="audit-note">{emptyLabel}</p> : null;
  }
  return (
    <ul className="audit-reasons" aria-label={label}>
      {reasons.map((reason, index) => (
        <li key={`${reason.code}-${index}`} className="audit-reason" data-result={reason.result}>
          <strong>{reason.message}</strong>
          {showTechnicalDetails ? (
            <>
              <span className="audit-mono">
                [{reason.code}] · {reason.result}
              </span>
              {reason.field ? (
                <span className="audit-mono">
                  {reason.field}: expected {format(reason.expected)}, received {format(reason.received)}
                </span>
              ) : null}
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}
