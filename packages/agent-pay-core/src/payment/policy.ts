import { artifactHash } from "./canonical.js";
import { authorizationDigest } from "./authorization.js";
import { publicKeyToAccountAddress } from "./casperSignature.js";
import type {
  AuthorizationIntent,
  OperatorPolicy,
  OriginalRequest,
  PaymentAssetEvidence,
  PaymentDecision,
  PaymentTerms,
  ProviderDecision,
  Reason,
  ReasonCode
} from "./types.js";

export type PaymentEvaluationInput = {
  checkId: string;
  request: OriginalRequest;
  terms: PaymentTerms;
  authorization: AuthorizationIntent | null;
  evidence: PaymentAssetEvidence;
  policy: OperatorPolicy | null;
  providerDecision: ProviderDecision | null;
  spent: string;
  reserved: string;
  replayedNonces: string[];
  activeReservations: number;
  now: string;
};

export function operatorPolicyHash(policy: OperatorPolicy): string {
  const { signature: _signature, policyHash: _policyHash, ...content } = policy;
  return artifactHash(content);
}

export function providerDecisionHash(decision: ProviderDecision): string {
  const { signature: _signature, decisionHash: _decisionHash, ...content } = decision;
  return artifactHash(content);
}

export function evaluatePayment(input: PaymentEvaluationInput): PaymentDecision {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new TypeError("Payment evaluation now must be an ISO timestamp");
  const nowSeconds = Math.floor(nowMs / 1000);
  const reasons: Reason[] = [];
  const advisories: Reason[] = [];

  evaluateResource(input, reasons, advisories);
  evaluateEvidence(input, nowMs, reasons);
  const providerPinned = evaluateProvider(input, nowMs, reasons);
  evaluatePolicy(input, reasons);
  evaluateAuthorization(input, nowSeconds, reasons);
  evaluateInvestmentAdvisories(input, reasons, advisories);

  const verdict: PaymentDecision["verdict"] = reasons.some((item) => item.result === "block")
    ? "block"
    : reasons.some((item) => item.result === "review")
      ? "review"
      : "pay";
  const policyHash = input.policy ? operatorPolicyHash(input.policy) : null;
  const authorizationDigestValue = input.authorization ? safeAuthorizationDigest(input.authorization) : null;
  const reservation =
    verdict === "pay" && input.authorization
      ? {
          amount: input.terms.amount,
          expiresAt: new Date(Number(input.authorization.validBefore) * 1000).toISOString()
        }
      : null;
  const decisionWithoutHash = {
    checkId: input.checkId,
    verdict,
    basis: verdict === "pay" && providerPinned ? ("operator_pinned" as const) : null,
    reasons,
    advisories,
    policyHash,
    authorizationDigest: authorizationDigestValue,
    reservation,
    decidedAt: new Date(nowMs).toISOString()
  };

  return {
    ...decisionWithoutHash,
    decisionHash: artifactHash(decisionWithoutHash)
  };
}

function evaluateResource(input: PaymentEvaluationInput, reasons: Reason[], advisories: Reason[]): void {
  if (!input.terms.resourceComparison.sameHost) {
    reasons.push(
      reason(
        "resource_origin_mismatch",
        "block",
        "Observed and declared x402 resource hosts differ",
        "resource.url.host",
        new URL(input.request.url).host,
        new URL(input.terms.resource.url).host
      )
    );
  }

  if (!input.terms.resourceComparison.sameScheme) {
    const tolerated =
      input.policy?.allowPinnedResourceSchemeMismatch === true &&
      input.providerDecision?.kind === "pin";
    const mismatch = reason(
      "resource_scheme_mismatch",
      tolerated ? "advisory" : "review",
      "Observed and declared x402 resource schemes differ",
      "resource.url.scheme",
      input.request.scheme,
      new URL(input.terms.resource.url).protocol.slice(0, -1)
    );
    (tolerated ? advisories : reasons).push(mismatch);
  }

  if (!input.terms.resourceComparison.samePath) {
    reasons.push(
      reason(
        "provider_tuple_changed",
        "review",
        "Observed and declared x402 resource paths differ",
        "resource.url.path",
        input.request.path,
        `${new URL(input.terms.resource.url).pathname}${new URL(input.terms.resource.url).search}`
      )
    );
  }
}

function evaluateEvidence(input: PaymentEvaluationInput, nowMs: number, reasons: Reason[]): void {
  const evidence = input.evidence;
  if (!evidence.packageExists || evidence.packageHash.toLowerCase() !== input.terms.asset.toLowerCase()) {
    reasons.push(
      reason(
        "asset_package_not_found",
        "block",
        "The selected payment package could not be resolved exactly",
        "asset",
        input.terms.asset,
        evidence.packageExists ? evidence.packageHash : null
      )
    );
  }
  if (!evidence.authorizationEntrypoint) {
    reasons.push(
      reason(
        "authorization_entrypoint_missing",
        "block",
        "The payment contract lacks transfer_with_authorization",
        "asset.entryPoint",
        "transfer_with_authorization",
        null
      )
    );
  }
  if (input.terms.extra.decimals !== null && evidence.decimals !== null && Number(input.terms.extra.decimals) !== evidence.decimals) {
    reasons.push(
      reason(
        "asset_decimals_mismatch",
        "block",
        "Declared token decimals differ from Casper state",
        "asset.decimals",
        evidence.decimals,
        input.terms.extra.decimals
      )
    );
  }

  const mandatoryMissing = [
    evidence.activeContractHash === null ? "activeContractHash" : null,
    evidence.decimals === null ? "decimals" : null,
    ...evidence.missing
  ].filter((item): item is string => item !== null);
  if (mandatoryMissing.length > 0) {
    reasons.push(
      reason(
        "evidence_unavailable",
        "review",
        "Mandatory payment-asset evidence is unavailable",
        "evidence.missing",
        [],
        [...new Set(mandatoryMissing)].sort()
      )
    );
  }

  if (input.policy) {
    const observedAt = Date.parse(evidence.observedAt);
    const maximumAgeMs = input.policy.evidenceMaxAgeSeconds * 1000;
    if (!Number.isFinite(observedAt) || observedAt > nowMs || nowMs - observedAt > maximumAgeMs) {
      reasons.push(
        reason(
          "evidence_unavailable",
          "review",
          "Payment-asset evidence is outside the signed freshness window",
          "evidence.observedAt",
          `within ${input.policy.evidenceMaxAgeSeconds} seconds`,
          evidence.observedAt
        )
      );
    }
  }
}

function evaluateProvider(input: PaymentEvaluationInput, nowMs: number, reasons: Reason[]): boolean {
  const decision = input.providerDecision;
  if (!decision) {
    reasons.push(reason("provider_unapproved", "review", "Provider has not been approved by the operator", "provider", "active pin", null));
    return false;
  }

  const exactTuple =
    decision.origin === input.request.origin &&
    decision.payee.toLowerCase() === input.terms.payTo.toLowerCase() &&
    decision.asset.toLowerCase() === input.terms.asset.toLowerCase() &&
    decision.network === input.terms.network &&
    (decision.resourcePathPrefix === null || input.request.path.startsWith(decision.resourcePathPrefix));
  if (!exactTuple) {
    reasons.push(
      reason(
        "provider_tuple_changed",
        decision.kind === "deny" ? "block" : "review",
        "The payment request does not match the signed provider tuple",
        "provider",
        {
          origin: decision.origin,
          payee: decision.payee,
          asset: decision.asset,
          network: decision.network,
          resourcePathPrefix: decision.resourcePathPrefix
        },
        {
          origin: input.request.origin,
          payee: input.terms.payTo,
          asset: input.terms.asset,
          network: input.terms.network,
          path: input.request.path
        }
      )
    );
    return false;
  }

  const providerExpiry = Date.parse(decision.expiresAt);
  if (!Number.isFinite(providerExpiry) || providerExpiry <= nowMs) {
    reasons.push(reason("provider_unapproved", "review", "Provider approval has expired", "provider.expiresAt", `after ${input.now}`, decision.expiresAt));
    return false;
  }

  if (decision.kind === "deny") {
    reasons.push(reason("operator_denied", "block", "Operator denied this provider tuple", "provider.kind", "pin", "deny"));
    return false;
  }

  if (parseAmount(input.terms.amount, "terms.amount") > parseAmount(decision.perCallCeiling, "provider.perCallCeiling")) {
    reasons.push(
      reason(
        "policy_per_call_exceeded",
        "block",
        "Payment amount exceeds the signed provider ceiling",
        "amount",
        `<= ${decision.perCallCeiling}`,
        input.terms.amount
      )
    );
  }
  return true;
}

function evaluatePolicy(input: PaymentEvaluationInput, reasons: Reason[]): void {
  const policy = input.policy;
  if (!policy) {
    reasons.push(reason("policy_cap_missing", "review", "No signed operator policy is active", "policy", "active signed policy", null));
    return;
  }

  const effectiveAt = Date.parse(policy.effectiveAt);
  if (!Number.isFinite(effectiveAt) || effectiveAt > Date.parse(input.now)) {
    reasons.push(
      reason(
        "policy_cap_missing",
        "review",
        "Signed operator policy is not effective at the evaluation time",
        "policy.effectiveAt",
        `<= ${input.now}`,
        policy.effectiveAt
      )
    );
  }

  if (!policy.allowedNetworks.includes(input.terms.network)) {
    reasons.push(reason("unsupported_network", "block", "Network is outside the signed operator policy", "network", policy.allowedNetworks, input.terms.network));
  }
  if (input.authorization && !policy.allowedPayerPublicKeys.includes(input.authorization.payerPublicKey)) {
    reasons.push(reason("operator_denied", "block", "Payer public key is outside the signed operator policy", "authorization.payerPublicKey", policy.allowedPayerPublicKeys, input.authorization.payerPublicKey));
  }
  if (policy.deniedOrigins.includes(input.request.origin)) {
    reasons.push(reason("operator_denied", "block", "Origin is explicitly denied", "request.origin", "not denied", input.request.origin));
  }
  if (policy.deniedPayees.map(lower).includes(input.terms.payTo.toLowerCase())) {
    reasons.push(reason("operator_denied", "block", "Payee is explicitly denied", "terms.payTo", "not denied", input.terms.payTo));
  }
  if (policy.deniedAssets.map(lower).includes(input.terms.asset.toLowerCase())) {
    reasons.push(reason("operator_denied", "block", "Payment asset is explicitly denied", "terms.asset", "not denied", input.terms.asset));
  }

  const cap = policy.assetDailyCaps[input.terms.asset.toLowerCase()];
  if (cap === undefined) {
    reasons.push(reason("policy_cap_missing", "review", "No signed daily cap covers the payment asset", "policy.assetDailyCaps", input.terms.asset, null));
  } else {
    const total = parseAmount(input.spent, "spent") + parseAmount(input.reserved, "reserved") + parseAmount(input.terms.amount, "terms.amount");
    if (total > parseAmount(cap, "policy.assetDailyCaps")) {
      reasons.push(reason("policy_daily_cap_exceeded", "block", "Payment would exceed the signed daily cap", "amount", `<= ${cap} including spend and reservations`, total.toString()));
    }
  }

  if (input.activeReservations >= policy.maximumConcurrentReservations) {
    reasons.push(reason("policy_daily_cap_exceeded", "block", "Maximum concurrent payment reservations reached", "activeReservations", `< ${policy.maximumConcurrentReservations}`, input.activeReservations));
  }
}

function evaluateAuthorization(input: PaymentEvaluationInput, nowSeconds: number, reasons: Reason[]): void {
  const authorization = input.authorization;
  if (!authorization) {
    reasons.push(reason("authorization_required", "review", "A complete unsigned authorization intent is required", "authorization", "complete intent", null));
    return;
  }

  const mismatches: Array<{ field: string; expected: unknown; received: unknown }> = [];
  compare(mismatches, "authorization.from", safeAccountAddress(authorization.payerPublicKey), authorization.from.toLowerCase());
  compare(mismatches, "authorization.to", input.terms.payTo.toLowerCase(), authorization.to.toLowerCase());
  compare(mismatches, "authorization.amount", input.terms.amount, authorization.amount);
  compare(mismatches, "authorization.network", input.terms.network, authorization.network);
  compare(mismatches, "authorization.asset", input.terms.asset.toLowerCase(), authorization.asset.toLowerCase());
  compare(mismatches, "authorization.tokenName", input.terms.extra.name, authorization.tokenName);
  compare(mismatches, "authorization.tokenVersion", input.terms.extra.version, authorization.tokenVersion);
  compare(mismatches, "authorization.digest", safeAuthorizationDigest(authorization), authorization.digest.toLowerCase());

  const validAfter = parseTimestampInteger(authorization.validAfter, "authorization.validAfter");
  const validBefore = parseTimestampInteger(authorization.validBefore, "authorization.validBefore");
  if (input.policy && validBefore - validAfter > input.policy.maximumAuthorizationWindowSeconds) {
    mismatches.push({
      field: "authorization.validityWindow",
      expected: `<= ${input.policy.maximumAuthorizationWindowSeconds}`,
      received: validBefore - validAfter
    });
  }
  if (validBefore - nowSeconds > input.terms.maxTimeoutSeconds) {
    mismatches.push({
      field: "authorization.remainingLifetime",
      expected: `<= ${input.terms.maxTimeoutSeconds}`,
      received: validBefore - nowSeconds
    });
  }

  for (const mismatch of mismatches) {
    reasons.push(reason("authorization_field_mismatch", "block", "Payment terms and authorization intent differ", mismatch.field, mismatch.expected, mismatch.received));
  }
  if (validAfter > nowSeconds) {
    reasons.push(reason("authorization_not_yet_valid", "block", "Authorization is not valid yet", "authorization.validAfter", `<= ${nowSeconds}`, validAfter));
  }
  if (validBefore <= nowSeconds) {
    reasons.push(reason("authorization_expired", "block", "Authorization has expired", "authorization.validBefore", `> ${nowSeconds}`, validBefore));
  }
  if (input.replayedNonces.map(lower).includes(authorization.nonce.toLowerCase())) {
    reasons.push(reason("authorization_replay", "block", "Authorization nonce has already been used or reserved", "authorization.nonce", "unique nonce", authorization.nonce));
  }
}

function evaluateInvestmentAdvisories(input: PaymentEvaluationInput, reasons: Reason[], advisories: Reason[]): void {
  const target = input.policy?.reviewOnInvestmentAdvisories ? reasons : advisories;
  const result = input.policy?.reviewOnInvestmentAdvisories ? "review" : "advisory";
  const evidence = input.evidence;

  if (evidence.mintAuthorityOpen === true) {
    target.push(reason("mint_authority_open", result, "Payment token mint authority is open", "evidence.mintAuthorityOpen", false, true));
  }
  if (evidence.supplyMutable === true) {
    target.push(reason("supply_mutable", result, "Payment token supply can change", "evidence.supplyMutable", false, true));
  }
  if (evidence.holderConcentrationPct !== null && evidence.holderConcentrationPct >= 95) {
    target.push(reason("holder_concentration", result, "Payment token holdings are highly concentrated", "evidence.holderConcentrationPct", "< 95", evidence.holderConcentrationPct));
  }
  if (evidence.contractAgeBlocks !== null && evidence.contractAgeBlocks < 1000) {
    target.push(reason("very_new_contract", result, "Payment token contract is very new", "evidence.contractAgeBlocks", ">= 1000", evidence.contractAgeBlocks));
  }
}

function safeAccountAddress(publicKey: string): string | null {
  try {
    return publicKeyToAccountAddress(publicKey);
  } catch {
    return null;
  }
}

function safeAuthorizationDigest(authorization: AuthorizationIntent): string | null {
  try {
    return authorizationDigest(authorization);
  } catch {
    return null;
  }
}

function compare(
  mismatches: Array<{ field: string; expected: unknown; received: unknown }>,
  field: string,
  expected: unknown,
  received: unknown
): void {
  if (expected !== received) mismatches.push({ field, expected, received });
}

function parseAmount(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${label} must be a non-negative integer string`);
  return BigInt(value);
}

function parseTimestampInteger(value: string, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${label} must be a non-negative integer string`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be a safe integer timestamp`);
  return parsed;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function reason(
  code: ReasonCode,
  result: Reason["result"],
  message: string,
  field: string,
  expected: unknown,
  received: unknown
): Reason {
  return { code, result, message, field, expected, received };
}
