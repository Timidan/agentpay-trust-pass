import { useState } from "react";
import { SealCheck, Warning, Flag, Eye, EyeSlash, ShareNetwork, ArrowSquareOut } from "@phosphor-icons/react";
import { Separator } from "@/components/ui/separator";
import type { Verdict } from "../api";
import { buildShareLink, shareVerdict, storeVerdictCard } from "../api";

type VerdictCardProps = {
  verdict: Verdict;
};

const ASPECT_LABEL: Record<Verdict["aspect"], string> = {
  CLEAR: "CLEAR",
  CAUTION: "CAUTION",
  DANGER: "DANGER"
};

type ShareState = "idle" | "sharing" | "shared" | "error";

export function VerdictCard({ verdict }: VerdictCardProps) {
  const shortHash = verdict.subject.packageHash.slice(0, 8);
  const shortTx = verdict.explorerUrl.split("/").pop()?.slice(0, 18) ?? "";
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareError, setShareError] = useState<string | null>(null);
  const [notCheckedExpanded, setNotCheckedExpanded] = useState(false);

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
      const { id } = await storeVerdictCard(cardData);
      const shareLink = buildShareLink(id);
      await shareVerdict(id, true);

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ url: shareLink, title: `AgentPay Trust Signal: ${verdict.aspect}` });
        } catch {
          await navigator.clipboard.writeText(shareLink);
        }
      } else {
        await navigator.clipboard.writeText(shareLink);
      }
      setShareState("shared");
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Share failed");
      setShareState("error");
    }
  }

  const aspectClass = verdict.aspect.toLowerCase() as "clear" | "caution" | "danger";
  const aspectVar = `var(--aspect-${aspectClass})`;

  return (
    <article
      className={`glass-card verdict-card verdict-card--${aspectClass}`}
      style={{ "--vc-aspect": aspectVar } as React.CSSProperties}
      aria-label={`Verdict: ${ASPECT_LABEL[verdict.aspect]}`}
    >
      {/* Lamp + aspect word hero row */}
      <div className="verdict-lamp-row">
        <div
          className="lamp-lens verdict-lamp"
          style={{ "--lamp-aspect": aspectVar } as React.CSSProperties}
          aria-hidden="true"
        />
        <div className="verdict-aspect-block">
          <p className="mono-label verdict-kicker">Token 0x{shortHash}</p>
          <div
            className="verdict-aspect-word"
            style={{ color: aspectVar }}
            aria-label={`Verdict: ${ASPECT_LABEL[verdict.aspect]}`}
          >
            {ASPECT_LABEL[verdict.aspect]}
          </div>
        </div>
      </div>

      {/* Rationale */}
      <p className="verdict-rationale">{verdict.rationale}</p>

      {/* Flags */}
      {verdict.flags.length > 0 ? (
        <ul className="verdict-flags" aria-label="Evidence flags">
          {verdict.flags.map((flag) => (
            <li key={flag.code} className="verdict-flag aspect-chip">
              {flag.severity === "high" ? (
                <Warning size={13} weight="bold" aria-hidden="true" />
              ) : (
                <Flag size={13} weight="bold" aria-hidden="true" />
              )}
              <code className="verdict-flag-code">{flag.code}</code>
              <span className="verdict-flag-message">{flag.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Not checked */}
      {verdict.notCheckedNote || verdict.notChecked.length > 0 ? (
        <div className="verdict-not-checked">
          <button
            className="verdict-not-checked-toggle"
            type="button"
            onClick={() => setNotCheckedExpanded((v) => !v)}
            aria-expanded={notCheckedExpanded}
          >
            {notCheckedExpanded ? (
              <EyeSlash size={13} weight="bold" aria-hidden="true" />
            ) : (
              <Eye size={13} weight="bold" aria-hidden="true" />
            )}
            Not checked yet:
          </button>
          {notCheckedExpanded ? (
            <p className="verdict-not-checked-detail">
              {verdict.notCheckedNote || verdict.notChecked.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Proof block */}
      <Separator style={{ background: "var(--box-line)", margin: "4px 0" }} />

      <div className="verdict-proof">
        <div className="verdict-proof-row">
          <SealCheck size={15} weight="bold" style={{ color: "var(--aspect-clear)", flexShrink: 0 }} aria-hidden="true" />
          <a
            className="verdict-explorer-link"
            href={verdict.explorerUrl}
            rel="noreferrer"
            target="_blank"
            aria-label="Proven on Casper"
          >
            Proven on Casper
            <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
          </a>
          <span className="data-mono verdict-tx-mono">{shortTx}...</span>
        </div>
        <div className="verdict-policy-row">
          <span className="mono-label" style={{ fontSize: "0.6rem" }}>Policy</span>
          <span className="data-mono verdict-policy-hash">{verdict.policyHash}</span>
        </div>
      </div>

      {/* Share */}
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
              : "SHARE"}
        </button>
        {shareState === "error" && shareError ? (
          <p className="verdict-share-error" role="alert">{shareError}</p>
        ) : null}
      </div>

      {/* Footer */}
      <footer className="verdict-footer">
        automated evidence flags, not financial advice
      </footer>
    </article>
  );
}
