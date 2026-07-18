import { hashJson } from "../hash.js";
import type { SubjectRef } from "./subject.js";
import type { SubjectSignals } from "./signals.js";
import type { AccountSignals } from "./accountSignals.js";
import type { Aspect, Flag, RuleResult, WireDecision } from "./rules.js";
import { SUBJECT_MANDATORY_SIGNALS, YOUNG_BLOCKS } from "./rules.js";
import {
  ACCOUNT_MANDATORY_SIGNALS,
  DUST_MOTES,
  YOUNG_ACCOUNT_BLOCKS
} from "./accountRules.js";

export const POLICY_VERSION = "agentpay-token-check/v3";
export const ACCOUNT_POLICY_VERSION = "agentpay-account-check/v3";

// Description of the policy that gets hashed on-chain. The mandatory-for-CLEAR
// list and thresholds are derived from the rule-engine constants (rules.ts /
// accountRules.ts) rather than hand-copied, so the recorded hash always
// reflects the engine that actually ran. `supplyControl` is the composite
// mint-control check the token engine treats as mandatory (it is not a raw
// signal key, so it is prepended here). Changing the flag vocabulary still
// requires bumping the version string.
const POLICY_DEFINITION = Object.freeze({
  version: POLICY_VERSION,
  hardFails: ["cep18_mint_burn_enabled", "single_lp_holder", "holder_concentration"],
  cautions: ["public_mint_entrypoint", "very_new_contract", "missing_mandatory_signal"],
  mandatoryForClear: ["supplyControl", ...SUBJECT_MANDATORY_SIGNALS],
  youngBlocks: YOUNG_BLOCKS,
} as const);

const ACCOUNT_POLICY_DEFINITION = Object.freeze({
  version: ACCOUNT_POLICY_VERSION,
  hardFails: ["account_not_found"],
  cautions: ["weak_key_management", "dust_balance", "very_new_account", "missing_mandatory_signal"],
  mandatoryForClear: [...ACCOUNT_MANDATORY_SIGNALS],
  dustMotes: DUST_MOTES.toString(),
  youngAccountBlocks: YOUNG_ACCOUNT_BLOCKS,
} as const);

export function policyHash(): string { return hashJson(POLICY_DEFINITION); }
export function accountPolicyHash(): string { return hashJson(ACCOUNT_POLICY_DEFINITION); }

export type VerdictReport = {
  policyVersion: string; policyHash: string; subject: SubjectRef; signals: SubjectSignals | AccountSignals;
  aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[];
  rationale: string; notCheckedNote: string;
};

export function buildVerdictReport(args: {
  subject: SubjectRef;
  signals: SubjectSignals | AccountSignals;
  rule: RuleResult;
  rationale: string;
  notCheckedNote: string;
  /** Override for non-token subjects; defaults to the token policy. */
  policyVersion?: string;
  policyHash?: string;
}): VerdictReport {
  return {
    policyVersion: args.policyVersion ?? POLICY_VERSION,
    policyHash: args.policyHash ?? policyHash(),
    subject: args.subject, signals: args.signals,
    aspect: args.rule.aspect, decision: args.rule.decision, flags: args.rule.flags,
    notChecked: args.rule.notChecked, rationale: args.rationale, notCheckedNote: args.notCheckedNote,
  };
}
