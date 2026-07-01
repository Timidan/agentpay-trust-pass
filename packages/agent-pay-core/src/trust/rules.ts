import type { SubjectSignals } from "./signals.js";

export type Aspect = "CLEAR" | "CAUTION" | "DANGER";
export type WireDecision = "approved" | "needs_review" | "rejected";
export type Flag = { code: string; severity: "danger" | "caution"; message: string };
export type RuleResult = { aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[] };

const MANDATORY: (keyof SubjectSignals)[] = ["mintAuthorityOpen", "supplyRenounced", "contractAgeBlocks", "holderCount"];
const YOUNG_BLOCKS = 1000;

export function scoreSubject(s: SubjectSignals): RuleResult {
  const flags: Flag[] = [];
  if (s.mintAuthorityOpen === true) flags.push({ code: "mint_authority_open", severity: "danger", message: "Mint authority is open — supply can be inflated." });
  if (s.supplyRenounced === false) flags.push({ code: "supply_not_renounced", severity: "danger", message: "Token supply control has not been renounced." });
  if (s.lpHolderCount === 1) flags.push({ code: "single_lp_holder", severity: "danger", message: "Liquidity is held by a single account." });
  if (s.holderCount === 1 || (s.topHolderPct !== null && s.topHolderPct >= 95)) flags.push({ code: "holder_concentration", severity: "danger", message: "Token holdings are extremely concentrated." });
  if (s.contractAgeBlocks !== null && s.contractAgeBlocks < YOUNG_BLOCKS) flags.push({ code: "very_new_contract", severity: "caution", message: "Contract is very new." });

  const notChecked = MANDATORY.filter((k) => s[k] == null).map(String);

  const aspect: Aspect = flags.some((f) => f.severity === "danger")
    ? "DANGER"
    : flags.length > 0 || notChecked.length > 0
      ? "CAUTION"
      : "CLEAR";
  const decision: WireDecision = aspect === "DANGER" ? "rejected" : aspect === "CAUTION" ? "needs_review" : "approved";
  return { aspect, decision, flags, notChecked };
}
