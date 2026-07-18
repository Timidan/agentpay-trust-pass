import type { SubjectSignals } from "./signals.js";

export type Aspect = "CLEAR" | "CAUTION" | "DANGER";
export type WireDecision = "approved" | "needs_review" | "rejected";
export type Flag = { code: string; severity: "danger" | "caution"; message: string };
// `passed` lists the mandatory checks that ran and came back clean, as
// humanized labels. It is signal-backed (never invented) so the UI can show
// real green rows next to the flags.
export type RuleResult = { aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[]; passed: string[] };

// The mandatory-for-CLEAR signal keys and the young-contract threshold are
// exported so the on-chain policy hash is derived from these exact constants
// (see policy.ts) rather than a hand-copied duplicate that can silently drift.
export const SUBJECT_MANDATORY_SIGNALS: readonly (keyof SubjectSignals)[] = Object.freeze([
  "contractAgeBlocks",
  "holderCount",
  "topHolderPct"
]);
export const YOUNG_BLOCKS = 1000;

export function scoreSubject(s: SubjectSignals): RuleResult {
  const flags: Flag[] = [];
  if (s.mintBurnEnabled === true) flags.push({
    code: "cep18_mint_burn_enabled",
    severity: "danger",
    message: "The CEP-18 mint and burn functions are enabled, so authorized roles can change token supply."
  });
  if (s.mintBurnEnabled === null && s.publicMintEntrypoint === true) flags.push({
    code: "public_mint_entrypoint",
    severity: "caution",
    message: "The active contract exposes a public mint entry point. Its internal access rules were not checked."
  });
  if (s.lpHolderCount === 1) flags.push({ code: "single_lp_holder", severity: "danger", message: "Liquidity is held by a single account." });
  if (s.holderCount === 1 || (s.topHolderPct !== null && s.topHolderPct >= 95)) flags.push({ code: "holder_concentration", severity: "danger", message: "Token holdings are extremely concentrated." });
  if (s.contractAgeBlocks !== null && s.contractAgeBlocks < YOUNG_BLOCKS) flags.push({
    code: "very_new_contract",
    severity: "caution",
    message: "The contract has existed for fewer than 1,000 blocks."
  });

  const notChecked = SUBJECT_MANDATORY_SIGNALS.filter((k) => s[k] == null).map(String);
  if (s.mintBurnEnabled === null && s.publicMintEntrypoint === null) {
    notChecked.unshift("supplyControl");
  }

  // Mandatory checks that ran and came back clean, as readable labels.
  const passed: string[] = [];
  if (s.mintBurnEnabled === false) {
    passed.push("The standard CEP-18 mint and burn setting is disabled.");
  } else if (s.publicMintEntrypoint === false) {
    passed.push("No public mint entry point was found in the active contract.");
  }
  if (s.contractAgeBlocks !== null && s.contractAgeBlocks >= YOUNG_BLOCKS) {
    passed.push("Contract has existed for at least 1,000 blocks.");
  }
  // Only a real pass when concentration was actually measured and is not high.
  if (s.holderCount !== null && s.holderCount > 1 && s.topHolderPct !== null && s.topHolderPct < 95) {
    passed.push("Top-holder concentration is below 95%.");
  }

  const aspect: Aspect = flags.some((f) => f.severity === "danger")
    ? "DANGER"
    : flags.length > 0 || notChecked.length > 0
      ? "CAUTION"
      : "CLEAR";
  const decision: WireDecision = aspect === "DANGER" ? "rejected" : aspect === "CAUTION" ? "needs_review" : "approved";
  return { aspect, decision, flags, notChecked, passed };
}
