import type { AccountSignals } from "./accountSignals.js";
import type { Aspect, Flag, RuleResult, WireDecision } from "./rules.js";

// One CSPR = 1e9 motes.
const DUST_MOTES = 1_000_000_000n;
const YOUNG_ACCOUNT_BLOCKS = 5_000;

// Facts a public node always returns for a live account. Their absence means
// the lookup itself failed — surfaced as "not checked", never silently CLEAR.
const MANDATORY: (keyof AccountSignals)[] = [
  "exists",
  "balanceMotes",
  "associatedKeyCount",
  "deploymentThreshold",
  "keyManagementThreshold"
];

/**
 * Score only the account facts AgentPay can prove from Casper RPC.
 */
export function scoreAccount(s: AccountSignals): RuleResult {
  const flags: Flag[] = [];
  const balanceMotes = parseBalanceMotes(s.balanceMotes);

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

  if (balanceMotes !== null) {
    if (balanceMotes < DUST_MOTES) {
      flags.push({
        code: "dust_balance",
        severity: "caution",
        message: "The account balance is below 1 CSPR.",
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

  const notChecked = MANDATORY
    .filter((key) => key === "balanceMotes" ? balanceMotes === null : s[key] == null)
    .map(String);

  // Mandatory checks that ran and came back clean, as readable labels.
  const passed: string[] = [];
  const flaggedCodes = new Set(flags.map((f) => f.code));
  if (s.exists === true) passed.push("Account exists on-chain.");
  if (balanceMotes !== null && !flaggedCodes.has("dust_balance")) {
    passed.push("CSPR balance is at least 1 CSPR.");
  }
  if (s.associatedKeyCount === 1) {
    passed.push("Account has one associated key.");
  } else if (
    s.associatedKeyCount !== null &&
    s.associatedKeyCount > 1 &&
    s.keyManagementThreshold !== null &&
    s.keyManagementThreshold > 1
  ) {
    passed.push("Key-management threshold requires more than one key.");
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

function parseBalanceMotes(value: string | null): bigint | null {
  if (value === null || !/^\d{1,155}$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
