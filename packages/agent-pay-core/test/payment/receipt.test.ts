import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it } from "vitest";
import {
  artifactHash,
  authorizationDigest,
  buildPurchaseReceipt,
  compareSettlement,
  evaluatePayment,
  normalizeOriginalRequest,
  normalizePaymentRequired,
  operatorActionMessage,
  operatorPolicyHash,
  providerDecisionHash,
  verifyPurchaseReceipt,
  type AuthorizationIntent,
  type OperatorPolicy,
  type PaymentAssetEvidence,
  type ProviderDecision,
  type PurchaseReceipt
} from "../../src/payment/index.js";

const NOW = "2026-07-09T16:13:00.000Z";
const TRANSACTION_HASH = "2458f77bcd56ae960c02d0dfba616c63f3008c7ee7e87bcfd861c4da87e774b4";
const ASSET = "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf";
const PAYEE = "00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8";
const PAYER = "01aff8a88e9d562dad2befec259a8818371d6d092328e8490bb6fc9644041c7c03";
const OPERATOR_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const OPERATOR = `01${Buffer.from(ed25519.getPublicKey(OPERATOR_PRIVATE_KEY)).toString("hex")}`;
const rpcFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/tab402-transaction.json", import.meta.url)), "utf8")
) as unknown;

describe("purchase receipts", () => {
  it("builds and independently verifies every signed and hashed artifact", () => {
    const receipt = validReceipt();

    expect(receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPurchaseReceipt(receipt)).toEqual({ verified: true, errors: [] });
  });

  it.each([
    ["response body", (receipt: PurchaseReceipt) => {
      if (!receipt.response) throw new Error("Fixture response is missing");
      receipt.response.bodyHash = "f".repeat(64);
    }],
    ["policy signature message", (receipt: PurchaseReceipt) => {
      receipt.policy.signatureMessage = `${receipt.policy.signatureMessage} `;
    }],
    ["authorization amount", (receipt: PurchaseReceipt) => {
      receipt.authorization.amount = "100000001";
    }],
    ["decoded settlement payee", (receipt: PurchaseReceipt) => {
      if (!receipt.settlement.decoded) throw new Error("Fixture settlement is missing");
      receipt.settlement.decoded.to = `00${"f".repeat(64)}`;
    }]
  ])("rejects tampering with the %s", (_label, mutate) => {
    const receipt = structuredClone(validReceipt());
    mutate(receipt);

    const result = verifyPurchaseReceipt(receipt);

    expect(result.verified).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

});

function validReceipt(): PurchaseReceipt {
  const request = normalizeOriginalRequest({
    method: "POST",
    url: "https://tab402.fly.dev/v1/speak",
    bodyHash: "0".repeat(64),
    bodyBytes: 36,
    capturedAt: NOW,
    adapterVersion: "receipt-test/1"
  });
  const normalized = normalizePaymentRequired({
    x402Version: 2,
    resource: {
      url: "http://tab402.fly.dev/v1/speak",
      description: "Text-to-speech",
      mimeType: "audio/mpeg"
    },
    accepts: [{
      scheme: "exact",
      network: "casper:casper-test",
      asset: ASSET,
      amount: "100000000",
      payTo: PAYEE,
      maxTimeoutSeconds: 900,
      extra: { name: "Casper X402 Token", version: "1", decimals: "9", symbol: "X402" }
    }]
  }, request);
  if (!normalized.ok) throw new Error("Receipt fixture payment terms did not normalize");

  const authorizationWithoutDigest = {
    payerPublicKey: PAYER,
    from: "00e27bfb95afa9b87a76e76d993928d8d4a1d119aea0f202cf4bf2cc036d534b28",
    to: PAYEE,
    amount: "100000000",
    validAfter: "1783613540",
    validBefore: "1783614440",
    nonce: "c611162ab90e14f33f6593f83674d4438285999b9f68fa33bcd8d69ea784b333",
    network: "casper:casper-test" as const,
    asset: ASSET,
    tokenName: "Casper X402 Token",
    tokenVersion: "1"
  };
  const authorization: AuthorizationIntent = {
    ...authorizationWithoutDigest,
    digest: authorizationDigest(authorizationWithoutDigest)
  };
  const evidenceContent = {
    network: "casper:casper-test" as const,
    packageHash: ASSET,
    packageExists: true,
    activeContractHash: "4".repeat(64),
    authorizationEntrypoint: true,
    name: "Casper X402 Token",
    symbol: "X402",
    decimals: 9,
    mintAuthorityOpen: false,
    supplyMutable: false,
    holderConcentrationPct: 20,
    contractAgeBlocks: 10_000,
    apiVersion: "2.0.0",
    observedBlockHash: "7".repeat(64),
    observedBlockHeight: 8_449_100,
    observedAt: NOW,
    missing: [],
    sourceErrors: []
  };
  const evidence: PaymentAssetEvidence = {
    ...evidenceContent,
    evidenceHash: artifactHash(evidenceContent)
  };
  const policy = signedPolicy();
  const providerDecision = signedProviderDecision();
  const checkId = "check-tab402";
  const decision = evaluatePayment({
    checkId,
    request,
    terms: normalized.terms,
    authorization,
    evidence,
    policy,
    providerDecision,
    spent: "0",
    reserved: "0",
    replayedNonces: [],
    activeReservations: 0,
    now: NOW
  });
  if (decision.verdict !== "pay") {
    throw new Error(`Receipt fixture did not produce PAY: ${JSON.stringify(decision.reasons)}`);
  }
  const settlement = compareSettlement({
    checkId,
    transactionHash: TRANSACTION_HASH,
    approved: authorization,
    rpcEnvelope: rpcFixture,
    rpcEndpoint: "https://node.testnet.casper.network/rpc",
    observedAt: "2026-07-09T16:20:00.000Z"
  });
  if (settlement.verdict !== "match") throw new Error("Receipt fixture settlement did not match");

  return buildPurchaseReceipt({
    receiptId: "receipt-tab402",
    checkId,
    request,
    terms: normalized.terms,
    evidence,
    policy,
    providerDecision,
    decision,
    authorization,
    settlement,
    response: {
      observerVersion: "agent-pay-client/0.1.0",
      status: 200,
      contentType: "audio/mpeg",
      bodyBytes: 42_000,
      bodyHash: "8".repeat(64),
      observedAt: "2026-07-09T16:20:01.000Z"
    },
    anchor: { status: "anchored", transactionHash: "9".repeat(64) },
    createdAt: "2026-07-09T16:20:02.000Z"
  });
}

function signedPolicy(): OperatorPolicy {
  const policy: OperatorPolicy = {
    policyId: "policy-1",
    operatorPublicKey: OPERATOR,
    revision: 1,
    issuedAt: NOW,
    effectiveAt: NOW,
    allowedNetworks: ["casper:casper-test"],
    allowedPayerPublicKeys: [PAYER],
    assetDailyCaps: { [ASSET]: "1000000000" },
    maximumAuthorizationWindowSeconds: 900,
    maximumConcurrentReservations: 5,
    deniedOrigins: [],
    deniedPayees: [],
    deniedAssets: [],
    evidenceMaxAgeSeconds: 3600,
    reviewOnInvestmentAdvisories: false,
    allowPinnedResourceSchemeMismatch: true,
    signatureMessage: "",
    signature: "",
    policyHash: ""
  };
  policy.policyHash = operatorPolicyHash(policy);
  const signed = signArtifact("policy_revision", policy.policyHash, policy.revision);
  policy.signatureMessage = signed.message;
  policy.signature = signed.signature;
  return policy;
}

function signedProviderDecision(): ProviderDecision {
  const decision: ProviderDecision = {
    decisionId: "provider-1",
    kind: "pin",
    operatorPublicKey: OPERATOR,
    revision: 1,
    origin: "https://tab402.fly.dev",
    payee: PAYEE,
    asset: ASSET,
    network: "casper:casper-test",
    resourcePathPrefix: "/v1/speak",
    perCallCeiling: "100000000",
    expiresAt: "2026-07-10T16:13:00.000Z",
    promptedByCheckId: "check-review",
    signatureMessage: "",
    signature: "",
    decisionHash: ""
  };
  decision.decisionHash = providerDecisionHash(decision);
  const signed = signArtifact("provider_decision", decision.decisionHash, decision.revision);
  decision.signatureMessage = signed.message;
  decision.signature = signed.signature;
  return decision;
}

function signArtifact(kind: "policy_revision" | "provider_decision", artifactHashValue: string, revision: number) {
  const message = operatorActionMessage({
    kind: "agentpay_auth_challenge",
    version: 1,
    domain: "agentpay.example",
    origin: "https://agentpay.example",
    network: "casper:casper-test",
    challengeId: `challenge-${kind}`,
    operatorPublicKey: OPERATOR,
    purpose: "operator_action",
    nonce: kind === "policy_revision" ? "a".repeat(64) : "b".repeat(64),
    issuedAt: NOW,
    expiresAt: "2026-07-09T16:18:00.000Z",
    requestedAction: { kind, artifactHash: artifactHashValue, revision }
  });
  const bytes = new TextEncoder().encode(`Casper Message:\n${message}`);
  return { message, signature: Buffer.from(ed25519.sign(bytes, OPERATOR_PRIVATE_KEY)).toString("hex") };
}
