import { Download } from "lucide-react";
import type { PaymentReceiptRecord } from "../api";
import type { AuditFlow } from "../useAuditFlow";
import { HashValue, StepStatusLine, testnetDeployUrl } from "./primitives";

const ANCHOR_MEANING: Record<string, string> = {
  off_chain_verified: "The receipt hash verifies locally, but it was not written to Casper.",
  pending: "The Casper registry transaction is still waiting for execution and readback.",
  anchored: "The receipt was written to Casper and the saved value matched.",
  failed: "The Casper registry transaction failed."
};

const ANCHOR_LABEL: Record<string, string> = {
  off_chain_verified: "verified off chain",
  pending: "waiting",
  anchored: "recorded on Casper",
  failed: "failed"
};

export function serializeReceiptForDownload(receipt: PaymentReceiptRecord["receipt"]): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function receiptDownloadName(receiptId: string): string {
  const safeId = receiptId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `agentpay-${safeId}.json`;
}

function downloadReceipt(receipt: PaymentReceiptRecord["receipt"]): void {
  const url = URL.createObjectURL(
    new Blob([serializeReceiptForDownload(receipt)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = receiptDownloadName(receipt.receiptId);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The receipt body is immutable (it carries the receipt hash). The anchor state
// is dynamic and rendered OUTSIDE that body, with its own poll status.
export function ReceiptView({ flow }: { flow: AuditFlow }) {
  const receipt = flow.receipt;
  const record = receipt.data;
  const body = record?.receipt ?? null;
  const anchor = flow.anchorState;

  return (
    <section className="audit-section" aria-label="Receipt" data-step-state={receipt.status}>
      <div className="audit-section-head">
        <h2>Receipt</h2>
        <span className="audit-tag" data-state={receipt.status}>
          receipt {receipt.status}
        </span>
      </div>

      <StepStatusLine status={receipt.status} error={receipt.error} emptyLabel="The receipt appears after the response is recorded." />

      {body ? (
        <>
          {/* Immutable receipt body — the hash covers exactly these fields. */}
          <dl className="audit-field-grid" aria-label="Immutable receipt body">
            <dt>receipt id</dt>
            <dd className="audit-mono">{body.receiptId}</dd>
            <dt>schema</dt>
            <dd className="audit-mono">{body.schemaVersion}</dd>
            <dt>check id</dt>
            <dd className="audit-mono">{body.checkId}</dd>
            <dt>decision</dt>
            <dd className="audit-mono" data-decision={body.decision.verdict}>
              {body.decision.verdict.toUpperCase()}
            </dd>
            <dt>amount</dt>
            <dd className="audit-mono">
              {body.terms.amount}
              {body.terms.extra.symbol ? ` ${body.terms.extra.symbol}` : ""}
            </dd>
            <dt>settlement</dt>
            <dd className="audit-mono" data-verdict={body.settlement.verdict}>
              {body.settlement.verdict}
            </dd>
            <dt>settlement tx</dt>
            <dd>
              <HashValue value={body.settlement.transactionHash} />
            </dd>
            {body.response ? (
              <>
                <dt>response</dt>
                <dd className="audit-mono">
                  {body.response.status} · {body.response.bodyBytes} bytes
                </dd>
              </>
            ) : null}
            <dt>receipt hash</dt>
            <dd>
              <HashValue value={body.receiptHash} />
            </dd>
            <dt>created</dt>
            <dd className="audit-mono">{body.createdAt}</dd>
          </dl>

          <div className="audit-actions">
            <button
              className="audit-button"
              type="button"
              title="Download the receipt JSON for offline verification"
              onClick={() => downloadReceipt(body)}
            >
              <Download size={16} aria-hidden="true" />
              Download receipt
            </button>
          </div>

          {/* Dynamic anchor state — outside the immutable body. */}
          <div className="audit-section" aria-label="Casper receipt record" data-anchor={anchor?.status ?? "unknown"}>
            <div className="audit-section-head">
              <h3>Casper record</h3>
              {anchor ? (
                <span className="audit-tag" data-anchor={anchor.status}>
                  {ANCHOR_LABEL[anchor.status] ?? anchor.status.replaceAll("_", " ")}
                </span>
              ) : null}
              <span className="audit-tag" data-poll={receipt.anchorPoll}>
                status check {receipt.anchorPoll}
              </span>
            </div>
            {anchor ? <p className="audit-note">{ANCHOR_MEANING[anchor.status]}</p> : null}
            {anchor?.transactionHash ? (
              <dl className="audit-field-grid">
                <dt>record transaction</dt>
                <dd>
                  <HashValue value={anchor.transactionHash} />
                </dd>
                <dt>explorer</dt>
                <dd className="audit-mono">
                  <a href={testnetDeployUrl(anchor.transactionHash)} target="_blank" rel="noreferrer">
                    cspr.live (Testnet)
                  </a>
                </dd>
              </dl>
            ) : (
              <p className="audit-note" data-state="not_checked">No Casper registry transaction was found.</p>
            )}
            {receipt.anchorPoll === "error" && receipt.error ? (
              <p className="audit-note" data-state="error">
                Casper record check failed: {receipt.error.message} [{receipt.error.code}]
              </p>
            ) : null}
            <div className="audit-actions">
              <button className="audit-button" type="button" onClick={() => void flow.refreshReceipt()}>
                Refresh Casper record
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
