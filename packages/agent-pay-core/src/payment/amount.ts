// The one definition of a token base-unit amount and the U256 transfer ceiling.
// The buyer's spend guard (refuse to sign an over-limit charge) and the server's
// public-assessment config check both bound amounts the same way; sharing this
// primitive keeps their regex and ceiling from drifting apart. Each caller maps
// the typed reason to its own error message.

export const U256_MAX = (1n << 256n) - 1n;

export type BaseUnitAmount =
  | { ok: true; amount: bigint }
  | { ok: false; reason: "not_positive_integer" | "exceeds_u256" };

// A positive whole number of base units (no leading zeros, no zero), within U256.
export function parseBaseUnitAmount(value: string): BaseUnitAmount {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return { ok: false, reason: "not_positive_integer" };
  }
  const amount = BigInt(value);
  if (amount > U256_MAX) {
    return { ok: false, reason: "exceeds_u256" };
  }
  return { ok: true, amount };
}
