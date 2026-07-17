import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CheckCircle, ClipboardText, SealCheck, ShareNetwork } from "@phosphor-icons/react";
import { Separator } from "@/components/ui/separator";
import type { Verdict } from "../api";
import { buildShareLink, shareVerdict, storeVerdictCard } from "../api";
import { friendlyError } from "../lib/friendly-errors";
import { AgentPayCheckList } from "../components/AgentPayCheckList";
import { buildCheckReceipt, casperTransactionUrl, serializeCheckReceipt } from "./check-receipt";

type VerdictCardProps = {
  verdict: Verdict;
  /** Kicker noun for the subject line, e.g. "Token" or "Account". */
  subjectLabel?: string;
  /** Friendlier subject hint (e.g. a resolved symbol) for the kicker line. */
  subjectHint?: string;
};

const ASPECT_LABEL: Record<Verdict["aspect"], string> = {
  CLEAR: "CLEAR",
  CAUTION: "CAUTION",
  DANGER: "DANGER"
};

type ShareState = "idle" | "sharing" | "shared" | "error";
type CopyState = "idle" | "copied" | "error";

export function VerdictCard({ verdict, subjectLabel = "Token", subjectHint }: VerdictCardProps) {
  const shortHash = verdict.subject.packageHash.slice(0, 8);
  const kickerSubject = subjectHint ?? shortHash;
  const shortTx = verdict.explorerUrl.split("/").pop()?.slice(0, 18) ?? "";
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareError, setShareError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  async function handleShare() {
    setShareState("sharing");
    setShareError(null);
    try {
      const cardData = {
        aspect: verdict.aspect,
        subjectShortHash: verdict.subject.packageHash.slice(0, 8),
        flags: verdict.flags.map((f) => ({ code: f.code, message: f.message })),
        notChecked: verdict.notChecked,
        decisionTxHash: verdict.decisionTxHash,
        policyHash: verdict.policyHash
      };
      const { id } = await storeVerdictCard({
        card: cardData,
        proof: verdict.publicationProof
      });
      const shareLink = buildShareLink(id);
      await shareVerdict(id, true);

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ url: shareLink, title: `AgentPay check: ${verdict.aspect}` });
        } catch {
          await navigator.clipboard.writeText(shareLink);
        }
      } else {
        await navigator.clipboard.writeText(shareLink);
      }
      setShareState("shared");
    } catch (err) {
      setShareError(friendlyError(err).headline);
      setShareState("error");
    }
  }

  async function handleCopyReceipt() {
    setCopyState("idle");
    try {
      await navigator.clipboard.writeText(serializeCheckReceipt(buildCheckReceipt(verdict)));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }

  const aspectClass = verdict.aspect.toLowerCase() as "clear" | "caution" | "danger";
  const aspectVar = `var(--aspect-${aspectClass})`;

  return (
    <article
      ref={cardRef}
      tabIndex={-1}
      className={`glass-card verdict-card verdict-card--${aspectClass}`}
      style={{ "--vc-aspect": aspectVar } as React.CSSProperties}
      aria-label={`Verdict: ${ASPECT_LABEL[verdict.aspect]}`}
    >
      <div className="verdict-lamp-row">
        <div
          className="lamp-lens verdict-lamp"
          style={{ "--lamp-aspect": aspectVar } as React.CSSProperties}
          aria-hidden="true"
        />
        <div className="verdict-aspect-block">
          <p className="mono-label verdict-kicker">{subjectLabel} {kickerSubject}</p>
          <h2 className="verdict-aspect-word" style={{ color: aspectVar }}>
            {ASPECT_LABEL[verdict.aspect]}
          </h2>
        </div>
      </div>

      <p className="verdict-rationale">{verdict.rationale}</p>

      <AgentPayCheckList
        flags={verdict.flags}
        notChecked={verdict.notChecked}
        passed={verdict.passed}
        notCheckedNote={verdict.notCheckedNote}
      />

      <Separator style={{ background: "var(--box-line)", margin: "4px 0" }} />

      <div className="verdict-proof">
        <div className="verdict-proof-row">
          <SealCheck size={15} weight="bold" style={{ color: "var(--aspect-clear)", flexShrink: 0 }} aria-hidden="true" />
          <a
            className="verdict-explorer-link"
            href={verdict.explorerUrl}
            rel="noreferrer"
            target="_blank"
            aria-label="Receipt on Casper"
          >
            Receipt on Casper
            <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
          </a>
          <span className="data-mono verdict-tx-mono">{shortTx}...</span>
        </div>
        <div className="verdict-policy-row">
          <span className="mono-label" style={{ fontSize: "0.6rem" }}>Rules ID</span>
          <span className="data-mono verdict-policy-hash">{verdict.policyHash}</span>
        </div>
      </div>

      <section className="verdict-receipt" aria-label="AgentPay check proof">
        <div className="verdict-receipt-head">
          <div>
            <span className="mono-label verdict-receipt-kicker">Check proof</span>
            <h3>Proof you can verify</h3>
          </div>
          <button
            className="verdict-receipt-copy"
            type="button"
            onClick={handleCopyReceipt}
            aria-label="Copy AgentPay check receipt"
          >
            {copyState === "copied" ? (
              <CheckCircle size={15} weight="bold" aria-hidden="true" />
            ) : (
              <ClipboardText size={15} weight="bold" aria-hidden="true" />
            )}
            {copyState === "copied" ? "Copied" : "Copy"}
          </button>
        </div>
        <dl className="verdict-receipt-rows">
          <ReceiptRow label="Checked data ID" value={verdict.datasetRoot} />
          <ReceiptRow label="Payment proof ID" value={verdict.paymentReceiptHash} />
          <ReceiptRow
            href={casperTransactionUrl(verdict.settlementTxHash)}
            label="Testnet payment"
            value={verdict.settlementTxHash}
          />
          <ReceiptRow href={verdict.explorerUrl} label="Casper result record" value={verdict.decisionTxHash} />
        </dl>
        {copyState === "error" ? (
          <p className="verdict-receipt-error" role="alert">Clipboard access is unavailable in this browser.</p>
        ) : null}
      </section>

      <div className="verdict-share">
        <button
          className="btn-pill-primary verdict-share-button"
          disabled={shareState === "sharing"}
          type="button"
          onClick={handleShare}
        >
          <ShareNetwork size={15} weight="bold" aria-hidden="true" />
          {shareState === "sharing"
            ? "Sharing..."
            : shareState === "shared"
              ? "Shared / link copied"
              : "Share"}
        </button>
        {shareState === "error" && shareError ? (
          <p className="verdict-share-error" role="alert">{shareError}</p>
        ) : null}
      </div>

      <footer className="verdict-footer">
        Based on automated checks of Casper data. This is not financial advice.
      </footer>
    </article>
  );
}

function ReceiptRow({ href, label, value }: { href?: string; label: string; value: string }) {
  return (
    <div className="verdict-receipt-row">
      <dt>{label}</dt>
      <dd>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            <code>{compactHash(value)}</code>
            <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
          </a>
        ) : (
          <code>{compactHash(value)}</code>
        )}
      </dd>
    </div>
  );
}

function compactHash(value: string): string {
  const bare = value.replace(/^hash-/, "");
  if (bare.length <= 22) return value;
  return `${bare.slice(0, 10)}...${bare.slice(-8)}`;
}
