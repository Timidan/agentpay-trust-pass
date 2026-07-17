import { useRef, useState } from "react";
import { ArrowSquareOut, Check, Copy } from "@phosphor-icons/react";
import type { DecisionReceipt as DecisionReceiptData } from "../api";

const DECISION_ASPECT: Record<DecisionReceiptData["input"]["decision"], string> = {
  approved: "CLEAR",
  needs_review: "CAUTION",
  rejected: "DANGER"
};

function middle(hash: string, head = 10, tail = 8): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

function HashValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  function copy() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <span className="hash-value">
      <code>{middle(value)}</code>
      <button
        type="button"
        className={`hash-copy${copied ? " is-copied" : ""}`}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        onClick={copy}
      >
        {copied ? <Check size={13} weight="bold" aria-hidden="true" /> : <Copy size={13} weight="bold" aria-hidden="true" />}
      </button>
    </span>
  );
}

export function AgentPayDecisionReceipt({
  receipt,
  proofDepth
}: {
  receipt: DecisionReceiptData | null;
  proofDepth?: number;
}) {
  if (!receipt) {
    return (
      <p className="muted">The Casper receipt appears here once a live run records its decision.</p>
    );
  }

  const explorer = `https://testnet.cspr.live/${receipt.hashKind}/${receipt.txHash}`;
  const aspect = DECISION_ASPECT[receipt.input.decision];

  return (
    <div className="decision-receipt">
      <dl className="receipt-dl">
        <div>
          <dt>Verdict</dt>
          <dd className={`receipt-verdict is-${aspect.toLowerCase()}`}>{aspect}</dd>
        </div>
        <div>
          <dt>Evidence set</dt>
          <dd><code>{receipt.input.datasetId}</code></dd>
        </div>
        <div>
          <dt>Evidence fingerprint</dt>
          <dd><HashValue value={receipt.input.datasetRoot} label="evidence fingerprint" /></dd>
        </div>
        {typeof proofDepth === "number" && proofDepth > 0 ? (
          <div>
            <dt>Verification path</dt>
            <dd>{proofDepth} {proofDepth === 1 ? "step" : "steps"}</dd>
          </div>
        ) : null}
        <div>
          <dt>Receipt hash</dt>
          <dd><HashValue value={receipt.input.paymentReceiptHash} label="receipt hash" /></dd>
        </div>
        <div>
          <dt>Transaction</dt>
          <dd><HashValue value={receipt.txHash} label="transaction hash" /></dd>
        </div>
        {receipt.confirmation.blockHash ? (
          <div>
            <dt>Block</dt>
            <dd><span className="receipt-block-tag">recorded in block {middle(receipt.confirmation.blockHash, 8, 6)}</span></dd>
          </div>
        ) : null}
      </dl>
      <a className="receipt-explorer-link" href={explorer} target="_blank" rel="noreferrer">
        View on cspr.live
        <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
      </a>
    </div>
  );
}
