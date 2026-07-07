import { hashJson } from "../hash.js";
import type { SubjectRef } from "./subject.js";
import type { SubjectSignals } from "./signals.js";
import type { AccountSignals } from "./accountSignals.js";
import type { Aspect, Flag, RuleResult, WireDecision } from "./rules.js";

export const POLICY_VERSION = "trust-signal/v1";
export const ACCOUNT_POLICY_VERSION = "trust-signal-account/v1";

// Frozen description of the policy; changing the rules must bump this object.
const POLICY_DEFINITION = Object.freeze({
  version: POLICY_VERSION,
  hardFails: ["mint_authority_open", "supply_not_renounced", "single_lp_holder", "holder_concentration"],
  cautions: ["very_new_contract", "missing_mandatory_signal"],
  mandatoryForClear: ["mintAuthorityOpen", "supplyRenounced", "contractAgeBlocks", "holderCount"],
  youngBlocks: 1000,
} as const);

const ACCOUNT_POLICY_DEFINITION = Object.freeze({
  version: ACCOUNT_POLICY_VERSION,
  hardFails: ["account_not_found"],
  cautions: ["weak_key_management", "dust_balance", "very_new_account", "missing_mandatory_signal"],
  mandatoryForClear: ["exists", "balanceMotes", "associatedKeyCount"],
  dustMotes: "1000000000",
  youngAccountBlocks: 5000,
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
