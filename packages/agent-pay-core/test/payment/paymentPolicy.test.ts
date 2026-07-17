import { describe, expect, it } from "vitest";
import {
  authorizationDigest,
  buildAuthorizationIntent,
  evaluatePayment,
  operatorPolicyHash,
  providerDecisionHash,
  type AuthorizationIntent,
  type OperatorPolicy,
  type OriginalRequest,
  type PaymentAssetEvidence,
  type PaymentEvaluationInput,
  type PaymentTerms,
  type ProviderDecision
} from "../../src/payment/index.js";

const NOW = "2026-07-15T21:00:00.000Z";
const NOW_SECONDS = Math.floor(Date.parse(NOW) / 1000);
const PAYER_PUBLIC_KEY = "01aff8a88e9d562dad2befec259a8818371d6d092328e8490bb6fc9644041c7c03";

describe("payment policy", () => {
  it("returns PAY only for a complete exact pinned request", () => {
    const result = evaluatePayment(base());

    expect(result).toMatchObject({
      verdict: "pay",
      basis: "operator_pinned",
      reasons: [],
      policyHash: policy().policyHash,
      authorizationDigest: authorization().digest,
      reservation: { amount: "100000000" }
    });
    expect(result.decisionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["no authorization", base({ authorization: null }), "review", "authorization_required"],
    ["no policy", base({ policy: null }), "review", "policy_cap_missing"],
    ["no provider pin", base({ providerDecision: null }), "review", "provider_unapproved"],
    ["missing package", base({ evidence: evidence({ packageExists: false }) }), "block", "asset_package_not_found"],
    ["missing entry point", base({ evidence: evidence({ authorizationEntrypoint: false }) }), "block", "authorization_entrypoint_missing"],
    ["wrong decimals", base({ evidence: evidence({ decimals: 8 }) }), "block", "asset_decimals_mismatch"],
    ["wrong on-chain token name", base({ evidence: evidence({ name: "Different Token" }) }), "block", "authorization_field_mismatch"],
    ["daily cap", base({ spent: "900000000", reserved: "100000000" }), "block", "policy_daily_cap_exceeded"],
    ["replayed nonce", base({ replayedNonces: [authorization().nonce] }), "block", "authorization_replay"]
  ] as const)("classifies %s", (_label, input, verdict, code) => {
    const result = evaluatePayment(input);

    expect(result.verdict).toBe(verdict);
    expect(result.reasons.map((reason) => reason.code)).toContain(code);
  });

  it("explains first-time setup gaps without protocol jargon", () => {
    const result = evaluatePayment(
      base({
        authorization: null,
        policy: null,
        providerDecision: null,
        terms: terms({ resourceComparison: { sameHost: true, sameScheme: true, samePath: true } })
      })
    );

    expect(result.reasons.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "provider_unapproved",
        message: "This service has not been approved for payment yet."
      },
      {
        code: "policy_cap_missing",
        message: "No payment rules are active for this account."
      },
      {
        code: "authorization_required",
        message: "The buyer has not prepared the payment details needed for signing."
      }
    ]);
  });

  it.each([
    ["to", { to: `00${"7".repeat(64)}` }],
    ["amount", { amount: "100000001" }],
    ["asset", { asset: "7".repeat(64) }],
    ["network", { network: "casper:other" }],
    ["token name", { tokenName: "Other" }],
    ["token version", { tokenVersion: "2" }]
  ])("blocks an authorization with changed %s", (_label, change) => {
    const changed = { ...authorization(), ...change } as AuthorizationIntent;
    changed.digest = authorizationDigest(changed);

    const result = evaluatePayment(base({ authorization: changed }));

    expect(result.verdict).toBe("block");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "authorization_field_mismatch" })
      ])
    );
  });

  it("does not let a valid pin override structural failures", () => {
    const result = evaluatePayment(
      base({
        evidence: evidence({ packageExists: false, authorizationEntrypoint: false, decimals: null })
      })
    );

    expect(result.verdict).toBe("block");
    expect(result.basis).toBeNull();
    expect(result.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["asset_package_not_found", "authorization_entrypoint_missing"])
    );
  });

  it("reviews unavailable package evidence without claiming the package is absent", () => {
    const result = evaluatePayment(
      base({
        evidence: evidence({
          packageExists: null,
          authorizationEntrypoint: null,
          activeContractHash: null,
          decimals: null,
          missing: ["package", "activeContractHash", "authorizationEntrypoint", "decimals"],
          sourceErrors: ["package: Casper RPC query_global_state timed out after 5000ms"]
        })
      })
    );

    expect(result.verdict).toBe("review");
    expect(result.reasons.map((reason) => reason.code)).toContain("evidence_unavailable");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("asset_package_not_found");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("authorization_entrypoint_missing");
  });

  it("keeps investment-style token signals as advisories by default", () => {
    const result = evaluatePayment(
      base({
        evidence: evidence({
          mintBurnEnabled: true,
          holderConcentrationPct: 99,
          contractAgeBlocks: 10
        })
      })
    );

    expect(result.verdict).toBe("pay");
    expect(result.advisories.map((reason) => reason.code)).toEqual([
      "resource_scheme_mismatch",
      "cep18_mint_burn_enabled",
      "holder_concentration",
      "very_new_contract"
    ]);
  });

  it("reports a public mint entry point when the CEP-18 setting is unavailable", () => {
    const result = evaluatePayment(
      base({ evidence: evidence({ mintBurnEnabled: null, publicMintEntrypoint: true }) })
    );

    expect(result.verdict).toBe("pay");
    expect(result.advisories).toContainEqual(
      expect.objectContaining({ code: "public_mint_entrypoint" })
    );
  });

  it("can elevate investment advisories to REVIEW through signed policy", () => {
    const strictPolicy = policy({ reviewOnInvestmentAdvisories: true });
    const result = evaluatePayment(
      base({
        policy: strictPolicy,
        evidence: evidence({ mintBurnEnabled: true })
      })
    );

    expect(result.verdict).toBe("review");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "cep18_mint_burn_enabled" })])
    );
  });

  it("requires an explicit policy tolerance before a pin can accept the Tab402 scheme mismatch", () => {
    const notTolerated = policy({ allowPinnedResourceSchemeMismatch: false });
    const result = evaluatePayment(base({ policy: notTolerated }));

    expect(result.verdict).toBe("review");
    expect(result.reasons.map((reason) => reason.code)).toContain("resource_scheme_mismatch");
  });

  it("blocks a host mismatch even when the provider tuple is otherwise pinned", () => {
    const changedTerms = terms({
      resourceComparison: { sameHost: false, sameScheme: true, samePath: true }
    });
    const result = evaluatePayment(base({ terms: changedTerms }));

    expect(result.verdict).toBe("block");
    expect(result.reasons.map((reason) => reason.code)).toContain("resource_origin_mismatch");
  });

  it("fails closed on malformed provider expiry and future policy activation", () => {
    const malformedProvider = evaluatePayment(
      base({ providerDecision: providerDecision({ expiresAt: "not-a-time" }) })
    );
    const futurePolicy = evaluatePayment(
      base({ policy: policy({ effectiveAt: "2026-07-16T21:00:00.000Z" }) })
    );

    expect(malformedProvider.verdict).toBe("review");
    expect(malformedProvider.reasons.map((reason) => reason.code)).toContain("provider_unapproved");
    expect(futurePolicy.verdict).toBe("review");
    expect(futurePolicy.reasons.map((reason) => reason.code)).toContain("policy_cap_missing");
  });

  it("rejects expired, future, and oversized authorization windows", () => {
    const expired = authorization({ validBefore: String(NOW_SECONDS) });
    const future = authorization({ validAfter: String(NOW_SECONDS + 1) });
    const oversized = authorization({ validAfter: String(NOW_SECONDS - 601), validBefore: String(NOW_SECONDS + 300) });

    expect(evaluatePayment(base({ authorization: expired })).reasons.map((reason) => reason.code)).toContain("authorization_expired");
    expect(evaluatePayment(base({ authorization: future })).reasons.map((reason) => reason.code)).toContain("authorization_not_yet_valid");
    expect(evaluatePayment(base({ authorization: oversized })).reasons.map((reason) => reason.code)).toContain("authorization_field_mismatch");
  });
});

function base(overrides: Partial<PaymentEvaluationInput> = {}): PaymentEvaluationInput {
  return {
    checkId: "check-1",
    request: request(),
    terms: terms(),
    authorization: authorization(),
    evidence: evidence(),
    policy: policy(),
    providerDecision: providerDecision(),
    spent: "0",
    reserved: "0",
    replayedNonces: [],
    activeReservations: 0,
    now: NOW,
    ...overrides
  };
}

function request(): OriginalRequest {
  return {
    method: "POST",
    url: "https://tab402.fly.dev/v1/speak",
    scheme: "https",
    origin: "https://tab402.fly.dev",
    path: "/v1/speak",
    bodyHash: "0".repeat(64),
    bodyBytes: 36,
    capturedAt: NOW,
    adapterVersion: "test",
    requestHash: "1".repeat(64)
  };
}

function terms(overrides: Partial<PaymentTerms> = {}): PaymentTerms {
  return {
    x402Version: 2,
    acceptanceIndex: 0,
    scheme: "exact",
    network: "casper:casper-test",
    asset: "5".repeat(64),
    amount: "100000000",
    payTo: `00${"6".repeat(64)}`,
    maxTimeoutSeconds: 300,
    extra: { name: "Casper X402 Token", version: "1", decimals: "9", symbol: "X402" },
    resource: {
      url: "http://tab402.fly.dev/v1/speak",
      description: "Text-to-speech",
      mimeType: "audio/mpeg"
    },
    resourceComparison: { sameHost: true, sameScheme: false, samePath: true },
    requirementHash: "2".repeat(64),
    ...overrides
  };
}

function authorization(overrides: Partial<AuthorizationIntent> = {}): AuthorizationIntent {
  const built = buildAuthorizationIntent({
    terms: terms(),
    payerPublicKey: PAYER_PUBLIC_KEY,
    nowEpochSeconds: NOW_SECONDS,
    nonce: "3".repeat(64)
  });
  const changed = { ...built, ...overrides };
  if (Object.keys(overrides).length > 0 && overrides.digest === undefined) {
    changed.digest = authorizationDigestForTest(changed);
  }
  return changed;
}

function authorizationDigestForTest(intent: AuthorizationIntent): string {
  return authorizationDigest(intent);
}

function evidence(overrides: Partial<PaymentAssetEvidence> = {}): PaymentAssetEvidence {
  const value = {
    network: "casper:casper-test" as const,
    packageHash: "5".repeat(64),
    packageExists: true,
    activeContractHash: "4".repeat(64),
    authorizationEntrypoint: true,
    name: "Casper X402 Token",
    symbol: "X402",
    decimals: 9,
    mintBurnEnabled: false,
    publicMintEntrypoint: false,
    holderConcentrationPct: 20,
    contractAgeBlocks: 10000,
    apiVersion: "2.0.0",
    observedBlockHash: "7".repeat(64),
    observedBlockHeight: 8_000_000,
    observedAt: NOW,
    missing: [],
    sourceErrors: [],
    evidenceHash: "8".repeat(64),
    ...overrides
  };
  return value;
}

function policy(overrides: Partial<OperatorPolicy> = {}): OperatorPolicy {
  const value: OperatorPolicy = {
    policyId: "policy-1",
    operatorPublicKey: PAYER_PUBLIC_KEY,
    revision: 1,
    issuedAt: NOW,
    effectiveAt: NOW,
    allowedNetworks: ["casper:casper-test"],
    allowedPayerPublicKeys: [PAYER_PUBLIC_KEY],
    assetDailyCaps: { ["5".repeat(64)]: "1000000000" },
    maximumAuthorizationWindowSeconds: 900,
    maximumConcurrentReservations: 5,
    deniedOrigins: [],
    deniedPayees: [],
    deniedAssets: [],
    evidenceMaxAgeSeconds: 3600,
    reviewOnInvestmentAdvisories: false,
    allowPinnedResourceSchemeMismatch: true,
    signatureMessage: "AgentPay Operator Action v1\n{}",
    signature: "9".repeat(128),
    policyHash: "",
    ...overrides
  };
  value.policyHash = operatorPolicyHash(value);
  return value;
}

function providerDecision(overrides: Partial<ProviderDecision> = {}): ProviderDecision {
  const value: ProviderDecision = {
    decisionId: "provider-1",
    kind: "pin",
    operatorPublicKey: PAYER_PUBLIC_KEY,
    revision: 1,
    origin: "https://tab402.fly.dev",
    payee: `00${"6".repeat(64)}`,
    asset: "5".repeat(64),
    network: "casper:casper-test",
    resourcePathPrefix: "/v1/speak",
    perCallCeiling: "100000000",
    expiresAt: "2026-07-16T21:00:00.000Z",
    promptedByCheckId: "check-first",
    signatureMessage: "AgentPay Operator Action v1\n{}",
    signature: "a".repeat(128),
    decisionHash: "",
    ...overrides
  };
  value.decisionHash = providerDecisionHash(value);
  return value;
}
