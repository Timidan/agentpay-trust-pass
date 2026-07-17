import { ArrowSquareOut } from "@phosphor-icons/react";
import type { RuleResult } from "../../../../packages/agent-pay-core/src/trust/rules";
import type { EvidenceNetwork } from "../api";
import { AgentPayButton, AgentPaySurface } from "./AgentPayUi";

export type HeroMode = "verdict" | "blocked";

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
  return parts.join(" ") || "Review the check results below before you continue.";
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
  evidenceNetwork,
  onChangeSubject,
  onChangeEvidenceNetwork,
  onRun,
  onShowPayment
}: {
  mode: HeroMode;
  verdict?: RuleResult;
  subjectLabel: string;
  summary: string | null;
  settlementHash: string | null;
  networkLabel: string;
  blockedNote?: string;
  running: boolean;
  primaryLabel: string;
  subjectInput: string;
  evidenceNetwork: EvidenceNetwork;
  onChangeSubject: (value: string) => void;
  onChangeEvidenceNetwork: (value: EvidenceNetwork) => void;
  onRun: (subject: string) => void;
  onShowPayment?: () => void;
}) {
  if (mode === "verdict" && !verdict) {
    throw new TypeError("A verified AgentPay verdict is required in verdict mode");
  }
  const rootClass = mode === "blocked" ? "is-blocked" : ASPECT_CLASS[verdict!.aspect];

  const canRun = !running && subjectInput.trim().length > 0;

  return (
    <AgentPaySurface className={`agent-pay-verdict-hero ${rootClass}`}>
      {mode === "blocked" ? (
        <div className="verdict-blocked">
          <h2 className="verdict-word verdict-word--blocked">Signed payment needed</h2>
          <p className="verdict-reason">
            {blockedNote ?? "The buyer must sign and submit the x402 payment before verification can continue."}
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
            <h2 className="verdict-word">{verdict!.aspect}</h2>
            <div className="verdict-detail">
              <p className="verdict-reason">{reasonLine(verdict!)}</p>
              {summary ? <p className="verdict-summary">{summary}</p> : null}
            </div>
          </div>

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
        </>
      )}

      <div className="hero-run">
        <AgentPayEvidenceNetworkSelector
          disabled={running}
          onChange={onChangeEvidenceNetwork}
          value={evidenceNetwork}
        />
        <input
          aria-label="Token package hash or Casper account to check"
          className="hero-run-input"
          placeholder="Token package hash or account (account-hash-…)"
          spellCheck={false}
          value={subjectInput}
          onChange={(event) => onChangeSubject(event.target.value)}
        />
        <AgentPayButton variant="primary" disabled={!canRun} onClick={() => onRun(subjectInput)}>
          {running ? primaryLabel : "Run live check"}
        </AgentPayButton>
      </div>
    </AgentPaySurface>
  );
}

export function AgentPayEvidenceNetworkSelector({
  disabled = false,
  onChange,
  value
}: {
  disabled?: boolean;
  onChange: (value: EvidenceNetwork) => void;
  value: EvidenceNetwork;
}) {
  return (
    <div className="hero-run-network" role="group" aria-label="Evidence network">
      {(["casper-mainnet", "casper-testnet"] as const).map((network) => (
        <button
          aria-pressed={value === network}
          className={value === network ? "is-active" : undefined}
          disabled={disabled}
          key={network}
          onClick={() => onChange(network)}
          type="button"
        >
          {network === "casper-mainnet" ? "Mainnet" : "Testnet"}
        </button>
      ))}
    </div>
  );
}
