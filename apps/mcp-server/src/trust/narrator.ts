type Flag = { code: string; severity: string; message: string };

type NarratorInput = {
  aspect: string;
  flags: Flag[];
  notChecked: string[];
  signals: Record<string, unknown>;
};

type NarratorOutput = {
  rationale: string;
  notCheckedNote: string;
};

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
export async function narrateVerdict(
  input: NarratorInput
): Promise<NarratorOutput> {
  return {
    rationale: buildRationale(input),
    notCheckedNote: buildNotCheckedNote(input.notChecked)
  };
}

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
