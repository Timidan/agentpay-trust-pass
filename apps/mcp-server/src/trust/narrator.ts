type Flag = { code: string; severity: string; message: string };

export type NarratorInput = {
  aspect: string;
  flags: Flag[];
  notChecked: string[];
  signals: Record<string, unknown>;
};

export type NarratorOutput = {
  rationale: string;
  notCheckedNote: string;
};

// The narrator seam: assessSubject computes the verdict aspect from the rule
// engine and only asks a NarrateVerdict for prose. The type is declared once
// here so the injection point (assess.ts) and the production adapter (tools.ts)
// cannot drift. The seam is real — a test injects a lying narrator to prove the
// aspect is owned by scoreSubject, not by whatever prose a future LLM returns.
export type NarrateVerdict = (input: NarratorInput) => Promise<NarratorOutput>;

const CHECK_LABELS: Record<string, string> = {
  mintBurnEnabled: "the token's mint and burn setting",
  publicMintEntrypoint: "the public mint entry point",
  supplyControl: "the token's standard mint controls",
  contractAgeBlocks: "contract age in blocks",
  holderCount: "holder count",
  topHolderPct: "the share held by its largest holder",
  exists: "account existence",
  balanceMotes: "CSPR balance",
  associatedKeyCount: "associated keys",
  deploymentThreshold: "the number of key weights required to send a transaction",
  keyManagementThreshold: "the number of key weights required to change account keys"
};

/**
 * Explain a rule-engine result without changing or reinterpreting it.
 * The same facts always produce the same text.
 */
export const narrateVerdict: NarrateVerdict = async (input) => {
  return {
    rationale: buildRationale(input),
    notCheckedNote: buildNotCheckedNote(input.notChecked)
  };
};

function buildRationale(input: NarratorInput): string {
  if (input.flags.length > 0) {
    const lead = input.flags.length === 1 ? "AgentPay found an issue:" : "AgentPay found these issues:";
    return `${lead} ${input.flags
      .map((flag) => flag.message)
      .join(" ")}`;
  }
  if (input.aspect === "CLEAR") {
    return "Every check required by this policy ran and passed. Review the receipt before you proceed.";
  }
  if (input.notChecked.length > 0) {
    return "AgentPay could not finish every check required by this policy. Review what is missing before you proceed.";
  }
  return "Review the check result and its receipt before you proceed.";
}

function buildNotCheckedNote(notChecked: string[]): string {
  if (notChecked.length === 0) {
    return "AgentPay completed every check required by this policy.";
  }
  return `AgentPay could not check: ${notChecked
    .map((key) => CHECK_LABELS[key] ?? key)
    .join(", ")}.`;
}
