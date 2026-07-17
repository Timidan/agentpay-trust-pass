const WHOLE_NUMBER = /^(0|[1-9][0-9]*)$/;
const DISPLAY_NUMBER = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const MAX_DECIMALS = 255;

export function formatAtomicAmount(atomicAmount: string, decimalsValue: string): string {
  if (!WHOLE_NUMBER.test(atomicAmount)) {
    throw new TypeError("The on-chain amount must be a whole number.");
  }
  const decimals = parseDecimals(decimalsValue);
  const normalized = atomicAmount.replace(/^0+(?=[0-9])/, "");
  if (decimals === 0) return normalized;

  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function parseDisplayAmount(displayAmount: string, decimalsValue: string): string {
  const value = displayAmount.trim();
  const match = DISPLAY_NUMBER.exec(value);
  if (!match) {
    throw new TypeError("Enter a plain positive number without signs or exponents.");
  }
  const decimals = parseDecimals(decimalsValue);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new TypeError(`This token supports at most ${decimals} decimal places.`);
  }
  const atomic = `${match[1]}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=[0-9])/, "");
  if (atomic === "0") {
    throw new TypeError("Enter a plain positive number greater than zero.");
  }
  return atomic;
}

function parseDecimals(value: string): number {
  if (!WHOLE_NUMBER.test(value)) {
    throw new TypeError("Token decimals must be a whole number.");
  }
  const decimals = Number(value);
  if (!Number.isSafeInteger(decimals) || decimals > MAX_DECIMALS) {
    throw new TypeError(`Token decimals must be between 0 and ${MAX_DECIMALS}.`);
  }
  return decimals;
}
