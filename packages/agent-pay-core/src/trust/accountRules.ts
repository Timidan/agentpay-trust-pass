import type { AccountSignals } from "./accountSignals.js";
import type { Aspect, Flag, RuleResult, WireDecision } from "./rules.js";

// One CSPR = 1e9 motes. A counterparty holding less than this reads as
// dormant/throwaway for the purpose of "should I transact with it".
const DUST_MOTES = 1_000_000_000n;
const YOUNG_ACCOUNT_BLOCKS = 5_000;

// Facts a public node always returns for a live account. Their absence means
// the lookup itself failed — surfaced as "not checked", never silently CLEAR.
const MANDATORY: (keyof AccountSignals)[] = ["exists", "balanceMotes", "associatedKeyCount"];

/**
 * Score a counterparty account. Danger = you're about to deal with something
 * that isn't there or can't be trusted to hold state; caution = thin or
 * loosely-controlled; clear = a funded, sanely-configured account.
 */
export function scoreAccount(s: AccountSignals): RuleResult {
  const flags: Flag[] = [];

  if (s.exists === false) {
    flags.push({
      code: "account_not_found",
      severity: "danger",
      message: "No account exists at this address on-chain.",
    });
  }

  // Multisig where a single key can still rotate all keys: a real takeover risk.
  if (
    s.associatedKeyCount !== null &&
    s.associatedKeyCount > 1 &&
    s.keyManagementThreshold !== null &&
    s.keyManagementThreshold <= 1
  ) {
    flags.push({
      code: "weak_key_management",
      severity: "caution",
      message: "A single key can rotate all keys on this multisig account.",
    });
  }

  if (s.balanceMotes !== null) {
    let motes = 0n;
    try {
      motes = BigInt(s.balanceMotes);
    } catch {
      motes = 0n;
    }
    if (motes < DUST_MOTES) {
      flags.push({
        code: "dust_balance",
        severity: "caution",
        message: "Account holds almost no CSPR, likely dormant or a throwaway.",
      });
    }
  }

  if (s.ageBlocks !== null && s.ageBlocks < YOUNG_ACCOUNT_BLOCKS) {
    flags.push({
      code: "very_new_account",
      severity: "caution",
      message: "Account was created very recently.",
    });
  }

  const notChecked = MANDATORY.filter((k) => s[k] == null).map(String);

  // Mandatory checks that ran and came back clean, as readable labels.
  const passed: string[] = [];
  const flaggedCodes = new Set(flags.map((f) => f.code));
  if (s.exists === true) passed.push("Account exists on-chain.");
  if (s.balanceMotes !== null && !flaggedCodes.has("dust_balance")) passed.push("Account is funded.");
  // A real pass only for a single key, or a multisig whose threshold is
  // actually known to require more than one key. Unknown threshold != sane.
  if (
    s.associatedKeyCount === 1 ||
    (s.associatedKeyCount !== null && s.associatedKeyCount > 1 && s.keyManagementThreshold !== null && s.keyManagementThreshold > 1)
  ) {
    passed.push("Key control looks sane.");
  }

  const aspect: Aspect = flags.some((f) => f.severity === "danger")
    ? "DANGER"
    : flags.length > 0 || notChecked.length > 0
      ? "CAUTION"
      : "CLEAR";
  const decision: WireDecision =
    aspect === "DANGER" ? "rejected" : aspect === "CAUTION" ? "needs_review" : "approved";
  return { aspect, decision, flags, notChecked, passed };
}
