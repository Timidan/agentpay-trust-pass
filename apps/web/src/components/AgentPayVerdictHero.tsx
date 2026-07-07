import { ArrowSquareOut, Check, FlagBanner, Play, WarningOctagon } from "@phosphor-icons/react";
import type { RuleResult } from "../../../../packages/agent-pay-core/src/trust/rules";
import { AgentPayButton, AgentPaySurface } from "./AgentPayUi";

export type HeroMode = "example" | "verdict" | "blocked";

/** Deterministic, honest reason line built only from real rule output. */
function reasonLine(v: RuleResult): string {
  const parts: string[] = [];
  const danger = v.flags.find((f) => f.severity === "danger");
  const caution = v.flags.find((f) => f.severity === "caution");
  if (danger) parts.push(danger.message);
  else if (caution) parts.push(caution.message);
  else if (v.aspect === "CLEAR") parts.push("Every mandatory check passed.");
  if (v.notChecked.length === 1) parts.push("One check could not run this time.");
  else if (v.notChecked.length > 1) parts.push(`${v.notChecked.length} checks could not run this time.`);
  return parts.join(" ") || "No specific flags were recorded.";
}

const ASPECT_CLASS: Record<RuleResult["aspect"], string> = {
  CLEAR: "is-clear",
  CAUTION: "is-caution",
  DANGER: "is-danger"
};

export function AgentPayVerdictHero({
  mode,
  verdict,
  subjectLabel,
  summary,
  settlementHash,
  networkLabel,
  blockedNote,
  running,
  primaryLabel,
  subjectInput,
  onChangeSubject,
  onRun,
  onShowPayment
}: {
  mode: HeroMode;
  verdict: RuleResult;
  subjectLabel: string;
  summary: string | null;
  settlementHash: string | null;
  networkLabel: string;
  blockedNote?: string;
  running: boolean;
  primaryLabel: string;
  subjectInput: string;
  onChangeSubject: (value: string) => void;
  onRun: (subject: string) => void;
  onShowPayment?: () => void;
}) {
  const rootClass =
    mode === "blocked" ? "is-blocked" : mode === "example" ? `is-example ${ASPECT_CLASS[verdict.aspect]}` : ASPECT_CLASS[verdict.aspect];

  const canRun = !running && subjectInput.trim().length > 0;

  return (
    <AgentPaySurface className={`agent-pay-verdict-hero ${rootClass}`}>
      {mode === "example" ? <span className="verdict-eyebrow">Sample run</span> : null}

      {mode === "blocked" ? (
        <div className="verdict-blocked">
          <h2 className="verdict-word verdict-word--blocked">Paused at the x402 wall</h2>
          <p className="verdict-reason">
            {blockedNote ?? "No signing key is configured here, so settle, verify, and record stay waiting."}
          </p>
          {onShowPayment ? (
            <AgentPayButton variant="secondary" size="compact" onClick={onShowPayment}>
              Show x402 payment
            </AgentPayButton>
          ) : null}
        </div>
      ) : (
        <>
          <div className="verdict-main">
            <h2 className="verdict-word">{verdict.aspect}</h2>
            <div className="verdict-detail">
              {mode === "example" ? <p className="verdict-note">Not a live result. Run your own below.</p> : null}
              <p className="verdict-reason">{reasonLine(verdict)}</p>
              {mode === "verdict" && summary ? <p className="verdict-summary">{summary}</p> : null}
            </div>
          </div>

          {mode === "example" ? (
            <ul className="aspect-legend" aria-label="What the verdicts mean">
              <li className="is-clear">
                <Check size={14} weight="bold" aria-hidden="true" />
                <b>CLEAR</b> nothing risky showed up.
              </li>
              <li className="is-caution">
                <FlagBanner size={14} weight="bold" aria-hidden="true" />
                <b>CAUTION</b> something needs a human look.
              </li>
              <li className="is-danger">
                <WarningOctagon size={14} weight="bold" aria-hidden="true" />
                <b>DANGER</b> a hard risk showed up.
              </li>
            </ul>
          ) : (
            <div className="identity-row">
              <span className="identity-subject">{subjectLabel}</span>
              <span className="identity-tag">{networkLabel}</span>
              {settlementHash ? (
                <a
                  className="identity-link"
                  href={`https://testnet.cspr.live/transaction/${settlementHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on cspr.live
                  <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          )}
        </>
      )}

      <div className="hero-run">
        <input
          aria-label="Token package hash or Casper account to check"
          className="hero-run-input"
          placeholder="Token package hash or account (account-hash-…)"
          spellCheck={false}
          value={subjectInput}
          onChange={(event) => onChangeSubject(event.target.value)}
        />
        <AgentPayButton variant="primary" disabled={!canRun} onClick={() => onRun(subjectInput)}>
          <Play size={16} weight="bold" aria-hidden="true" />
          {running ? primaryLabel : "Run it live"}
        </AgentPayButton>
      </div>
    </AgentPaySurface>
  );
}
