import type { AuditFlow } from "../useAuditFlow";
import { ReasonList } from "./DecisionPanel";
import { HashValue, StepStatusLine, testnetTransactionUrl } from "./primitives";

// The four settlement verdicts stay distinct: match | pending | mismatch |
// unverifiable. Pending and unverifiable never collapse into success or failure.
const VERDICT_MEANING: Record<string, string> = {
  match: "Executed transfer matched the approved terms.",
  pending: "Transaction is awaiting execution or readback. Not decided yet.",
  mismatch: "Executed transfer did not match the approved terms.",
  unverifiable: "The transfer could not be verified from the available data."
};

export function SettlementVerdict({ flow }: { flow: AuditFlow }) {
  const settlement = flow.settlement;
  const proof = settlement.data?.proof ?? null;
  const verdict = flow.settlementVerdict;

  return (
    <section
      className="audit-section"
      aria-label="Settlement verdict"
      data-step-state={settlement.status}
      data-verdict={verdict ?? "none"}
    >
      <div className="audit-section-head">
        <h2>Settlement</h2>
        {verdict ? (
          <span className="audit-tag" data-verdict={verdict}>
            {verdict}
          </span>
        ) : null}
      </div>

      <StepStatusLine
        status={settlement.status}
        error={settlement.error}
        emptyLabel="Verify a settlement transaction after the buyer signs."
      />

      {proof ? (
        <>
          <p className="audit-note">{VERDICT_MEANING[proof.verdict]}</p>
          <dl className="audit-field-grid">
            <dt>transaction</dt>
            <dd>
              <HashValue value={proof.transactionHash} />
            </dd>
            <dt>explorer</dt>
            <dd className="audit-mono">
              <a href={testnetTransactionUrl(proof.transactionHash)} target="_blank" rel="noreferrer">
                cspr.live (Testnet)
              </a>
            </dd>
            {proof.blockHash ? (
              <>
                <dt>block</dt>
                <dd>
                  <HashValue value={proof.blockHash} />
                </dd>
              </>
            ) : null}
            {proof.blockHeight !== null ? (
              <>
                <dt>height</dt>
                <dd className="audit-mono">{proof.blockHeight}</dd>
              </>
            ) : null}
            <dt>rpc</dt>
            <dd className="audit-mono">{proof.rpcEndpoint}</dd>
          </dl>

          <ReasonList label="Settlement reasons" reasons={proof.reasons ?? []} emptyLabel="No settlement reasons reported." />

          {(proof.verdict === "pending" || proof.verdict === "unverifiable") && flow.decision === "pay" ? (
            <div className="audit-actions">
              <button
                className="audit-button"
                type="button"
                disabled={settlement.status === "running"}
                onClick={() => void flow.verifySettlement(proof.transactionHash)}
              >
                Re-verify this transaction
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
