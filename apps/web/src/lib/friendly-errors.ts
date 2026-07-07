/**
 * Maps raw backend error codes/messages to copy a person can act on.
 * The raw code stays available as `detail` for the small-print, so the
 * consumer never loses the exact failure, it just isn't the headline.
 */

export type FriendlyError = {
  headline: string;
  detail?: string;
};

const REASON_COPY: Record<string, string> = {
  subject_must_be_casper_package_hash:
    "That doesn't look like a Casper token address. Paste the token's package hash. It starts with \"hash-\" followed by 64 hex characters.",
  payment_rejected:
    "The desk rejected this payment. Request a fresh quote and try again.",
  malformed_payment_signature:
    "The payment payload didn't parse as a signed x402 payment. Re-sign the quote and try again.",
  payment_verifier_unconfigured:
    "This desk can't verify payments yet. Its payment verifier isn't configured.",
  x402_asset_package_hash_required:
    "This desk can't take payments yet. Its payment asset isn't configured.",
  payee_address_required:
    "This desk can't take payments yet. It has no payee account configured.",
  agent_pay_registry_package_hash_required:
    "This desk can't record decisions on Casper yet. Its registry contract isn't configured.",
  agent_pay_registry_package_hash_invalid:
    "This desk's registry contract address is invalid. It must be a 64-hex-character package hash.",
  agent_pay_registry_configuration_required:
    "This desk can't record decisions on Casper yet. Its registry setup is incomplete.",
  x402_asset_package_hash_must_be_64_hex_chars:
    "This desk's payment asset is misconfigured. The package hash must be 64 hex characters.",
  payee_address_must_be_00_plus_64_hex_chars:
    "This desk's payee account is misconfigured. It must be \"00\" followed by 64 hex characters.",
  payment_requirement_required:
    "This desk can't take payments yet. No payment requirement is configured.",
  payment_configuration_required:
    "This desk can't take payments yet. Payment settings are incomplete.",
  x402_facilitator_auth_required:
    "The payment facilitator needs an access token before settlements can run.",
  x402_facilitator_supported_check_failed:
    "The payment facilitator can't be reached right now. Try again in a moment.",
  x402_facilitator_network_unsupported:
    "The payment facilitator doesn't support this network yet.",
  settlement_transaction_not_executed:
    "The settlement transaction didn't execute on Casper. Nothing was recorded."
};

const SUBSTRING_COPY: Array<{ match: string; copy: string }> = [
  {
    match: "CASPER_SECRET_KEY_PATH",
    copy: "This desk isn't set up to run live checks yet. The operator still needs to configure a Casper signing key."
  },
  {
    match: "AGENT_PAY_REGISTRY_PACKAGE_HASH",
    copy: "This desk can't record decisions on Casper yet. Its registry contract isn't configured."
  },
  {
    match: "CASPER_RPC_URL",
    copy: "This desk has no Casper RPC endpoint configured, so it can't confirm on-chain activity."
  },
  {
    match: "Invalid subject",
    copy: "That doesn't look like a Casper token address. Paste the token's package hash. It starts with \"hash-\" followed by 64 hex characters."
  },
  {
    match: "Failed to fetch",
    copy: "Can't reach the trust desk. Check that the AgentPay services are running, then try again."
  },
  // JSON.parse SyntaxErrors from a non-JSON response body (proxy HTML, 502,
  // empty). Matched by their specific prefixes so curated "isn't valid JSON"
  // copy is never clobbered.
  {
    match: "Unexpected token",
    copy: "The trust desk returned an unexpected response. Check that the AgentPay services are running, then try again."
  },
  {
    match: "Unexpected end of JSON",
    copy: "The trust desk returned an unexpected response. Check that the AgentPay services are running, then try again."
  }
];

/** Friendly copy for a raw reason code (e.g. quote.paymentReadiness.reason). */
export function friendlyReason(code: string | null | undefined): FriendlyError {
  if (!code) {
    return { headline: "Something didn't work. Try again in a moment." };
  }
  const known = REASON_COPY[code];
  if (known) {
    return { headline: known, detail: code };
  }
  for (const { match, copy } of SUBSTRING_COPY) {
    if (code.includes(match)) {
      return { headline: copy, detail: code };
    }
  }
  const humanized = humanizeCode(code);
  // Unmapped plain sentences pass through as-is; repeating them as detail
  // would just render the same text twice.
  return humanized === code ? { headline: code } : { headline: humanized, detail: code };
}

/** Friendly copy for a thrown error (fetch failures, tool errors, etc.). */
export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof Error) {
    return friendlyReason(err.message);
  }
  return { headline: "Something didn't work. Try again in a moment." };
}

/** Last resort: turn snake_case codes into a sentence rather than leaking them. */
function humanizeCode(code: string): string {
  if (!/^[a-z0-9_]+$/i.test(code) || !code.includes("_")) {
    return code;
  }
  const words = code.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1) + ".";
}
