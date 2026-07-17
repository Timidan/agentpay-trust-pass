import { useState } from "react";
import type { AuditFlow } from "../useAuditFlow";
import type { ResponseObservationInput } from "../api";
import { HashValue, StepStatusLine } from "./primitives";

const HASH = /^[0-9a-f]{64}$/;
const STATUS_LABEL = {
  idle: "not recorded",
  running: "recording",
  success: "recorded",
  error: "needs attention"
} as const;

// Records the bounded service response after an exact settlement match. The
// values describe what the buyer's paid response actually was; the backend binds
// them into the immutable receipt.
export function ResponseObservation({ flow }: { flow: AuditFlow }) {
  const ready = flow.settlementVerdict === "match";
  const [status, setStatus] = useState("200");
  const [contentType, setContentType] = useState("application/json");
  const [bodyBytes, setBodyBytes] = useState("0");
  const [bodyHash, setBodyHash] = useState("");
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString());

  const observation = flow.observation;
  const recorded = observation.data?.observation ?? null;
  const validHash = HASH.test(bodyHash.trim().toLowerCase());
  const statusNumber = Number(status);
  const bytesNumber = Number(bodyBytes);
  const valid =
    validHash &&
    Number.isInteger(statusNumber) &&
    statusNumber >= 100 &&
    statusNumber <= 599 &&
    Number.isInteger(bytesNumber) &&
    bytesNumber >= 0;

  return (
    <section className="audit-section" aria-label="Response observation" data-step-state={observation.status}>
      <div className="audit-section-head">
        <h2>Service response</h2>
        <span className="audit-tag" data-state={observation.status}>
          {STATUS_LABEL[observation.status]}
        </span>
      </div>

      {recorded ? (
        <>
          <p className="audit-note" data-state="success">
            AgentPay recorded the response returned after payment.
          </p>
          <dl className="audit-field-grid">
            <dt>HTTP status</dt>
            <dd>{recorded.status}</dd>
            <dt>content type</dt>
            <dd>{recorded.contentType ?? "Not provided"}</dd>
            <dt>response size</dt>
            <dd>{recorded.bodyBytes.toLocaleString()} bytes</dd>
            <dt>body hash</dt>
            <dd>
              <HashValue value={recorded.bodyHash} />
            </dd>
            <dt>recorded at</dt>
            <dd>
              <time className="audit-mono" dateTime={recorded.observedAt}>
                {recorded.observedAt}
              </time>
            </dd>
            <dt>observation fingerprint</dt>
            <dd>
              <HashValue value={recorded.observationHash} />
            </dd>
          </dl>
        </>
      ) : !ready ? (
        <p className="audit-note">
          AgentPay records the service response after the Casper transfer matches the approved payment.
        </p>
      ) : (
        <>
          <p className="audit-note">
            The browser normally records the paid response automatically.
          </p>
          <details className="audit-disclosure">
            <summary className="audit-note">Record a response from another client</summary>
            <form
              className="audit-preparation"
              onSubmit={(event) => {
                event.preventDefault();
                if (!valid) return;
                const input: ResponseObservationInput = {
                  observerVersion: "agentpay-web/0.1.0",
                  status: statusNumber,
                  contentType: contentType.trim() ? contentType.trim() : null,
                  bodyBytes: bytesNumber,
                  bodyHash: bodyHash.trim().toLowerCase(),
                  observedAt
                };
                void flow.recordObservation(input);
              }}
            >
              <dl className="audit-field-grid">
                <dt>status</dt>
                <dd>
                  <input className="audit-input" aria-label="HTTP status" value={status} onChange={(e) => setStatus(e.target.value)} />
                </dd>
                <dt>content type</dt>
                <dd>
                  <input
                    className="audit-input"
                    aria-label="Content type"
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                  />
                </dd>
                <dt>body bytes</dt>
                <dd>
                  <input className="audit-input" aria-label="Body bytes" value={bodyBytes} onChange={(e) => setBodyBytes(e.target.value)} />
                </dd>
                <dt>body hash</dt>
                <dd>
                  <input
                    className="audit-input audit-mono"
                    aria-label="Body hash"
                    placeholder="64-character sha256"
                    value={bodyHash}
                    onChange={(e) => setBodyHash(e.target.value)}
                  />
                </dd>
                <dt>observed at</dt>
                <dd>
                  <input
                    className="audit-input audit-mono"
                    aria-label="Observed at"
                    value={observedAt}
                    onChange={(e) => setObservedAt(e.target.value)}
                  />
                </dd>
              </dl>
              <div className="audit-actions">
                <button className="audit-button" type="submit" disabled={!valid || observation.status === "running"}>
                  {observation.status === "running" ? "Recording…" : "Record response"}
                </button>
              </div>
            </form>
          </details>
        </>
      )}

      {observation.status === "running" || observation.status === "error" ? (
        <StepStatusLine status={observation.status} error={observation.error} emptyLabel="" />
      ) : null}
    </section>
  );
}
