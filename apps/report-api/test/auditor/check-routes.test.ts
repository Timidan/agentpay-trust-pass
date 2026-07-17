import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { ed25519 } from "@noble/curves/ed25519";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAuthorizationIntent,
  normalizeOriginalRequest,
  normalizePaymentRequired,
  operatorPolicyHash,
  providerDecisionHash,
  type OperatorPolicy,
  type PaymentAssetEvidence,
  type ProviderDecision
} from "@agent-pay/core";
import { AuditorAuth, hashBearerToken } from "../../src/auditor/auth.js";
import { createAuditorRouter } from "../../src/auditor/routes.js";
import { PaymentAuditService } from "../../src/auditor/service.js";
import { openSqliteRepository, type SqliteAuditorRepository } from "../../src/auditor/sqliteRepository.js";
import { createReportApp } from "../../src/app.js";

const ORIGIN = "https://agentpay.example";
const NOW = "2026-07-15T21:00:00.000Z";
const OPERATOR_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const PAYER_PRIVATE_KEY = new Uint8Array(32).fill(7);
const OTHER_PAYER_PRIVATE_KEY = new Uint8Array(32).fill(8);
const OPERATOR = `01${Buffer.from(ed25519.getPublicKey(OPERATOR_PRIVATE_KEY)).toString("hex")}`;
const PAYER = `01${Buffer.from(ed25519.getPublicKey(PAYER_PRIVATE_KEY)).toString("hex")}`;
const OTHER_PAYER = `01${Buffer.from(ed25519.getPublicKey(OTHER_PAYER_PRIVATE_KEY)).toString("hex")}`;
const ASSET = "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf";
const CONTRACT = "81ad8086b869c0ad6b06ce38bedb82542411531b930962be5479c88f144ef4df";
const PAYEE = "00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8";
const AGENT_TOKEN = Buffer.alloc(32, 4).toString("base64url");
const openRepositories: SqliteAuditorRepository[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const repository of openRepositories.splice(0)) repository.close();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("payment check routes", () => {
  it("returns REVIEW on first use with a complete reason instead of claiming safety", async () => {
    const context = createContext();

    const response = await postCheck(context.app, checkBody(), "first-use").expect(201);

    expect(response.body).toMatchObject({
      created: true,
      check: {
        status: "review",
        decision: { verdict: "review", basis: null, reservation: null }
      }
    });
    expect(reasonCodes(response.body.check)).toContain("provider_unapproved");
    expect(context.repository.getReservation(response.body.check.id)).toBeNull();
  });

  it("returns PAY and creates a durable reservation for an exact active pin", async () => {
    const context = createContext({ pinned: true });

    const response = await postCheck(context.app, checkBody(), "pinned-pay").expect(201);

    expect(response.body.check).toMatchObject({
      status: "reserved",
      decision: { verdict: "pay", basis: "operator_pinned" }
    });
    expect(context.repository.getReservation(response.body.check.id)).toMatchObject({
      amount: "100",
      status: "active"
    });
  });

  it("evaluates evidence freshness after asynchronous evidence collection completes", async () => {
    const context = createContext({ pinned: true, advanceClockDuringEvidence: true });

    const response = await postCheck(context.app, checkBody(), "fresh-after-rpc").expect(201);

    expect(response.body.check.decision.verdict).toBe("pay");
    expect(reasonCodes(response.body.check)).not.toContain("evidence_unavailable");
  });

  it("blocks a payment when the 402 amount changes after authorization construction", async () => {
    const context = createContext({ pinned: true });
    const body = checkBody();
    (body.paymentRequired.accepts[0] as { amount: string }).amount = "101";

    const response = await postCheck(context.app, body, "tampered-amount").expect(201);

    expect(response.body.check.decision.verdict).toBe("block");
    expect(reasonCodes(response.body.check)).toContain("authorization_field_mismatch");
    expect(context.repository.getReservation(response.body.check.id)).toBeNull();
  });

  it("blocks a nonce replay even when the second request has a different idempotency key", async () => {
    const context = createContext({ pinned: true });
    const body = checkBody({ nonce: "a".repeat(64) });
    await postCheck(context.app, body, "nonce-first").expect(201);

    const replay = await postCheck(context.app, body, "nonce-second").expect(201);

    expect(replay.body.check.decision.verdict).toBe("block");
    expect(reasonCodes(replay.body.check)).toContain("authorization_replay");
  });

  it("returns the original check for an exact idempotent retry without repeating RPC evidence", async () => {
    const context = createContext({ pinned: true });
    const body = checkBody();
    const first = await postCheck(context.app, body, "retry-key").expect(201);
    const second = await postCheck(context.app, body, "retry-key").expect(200);

    expect(second.body).toMatchObject({ created: false, check: { id: first.body.check.id } });
    expect(context.evidenceCalls()).toBe(1);
  });

  it("rejects reuse of an idempotency key for different payment content", async () => {
    const context = createContext({ pinned: true });
    await postCheck(context.app, checkBody(), "conflicting-key").expect(201);
    const changed = checkBody({ nonce: "b".repeat(64) });

    const response = await postCheck(context.app, changed, "conflicting-key").expect(409);

    expect(response.body.code).toBe("idempotency_conflict");
  });

  it("rejects an agent token used for a payer outside its signed binding", async () => {
    const context = createContext({ pinned: true });
    const body = checkBody({ payerPublicKey: OTHER_PAYER, nonce: "c".repeat(64) });

    const response = await postCheck(context.app, body, "wrong-payer").expect(403);

    expect(response.body).toMatchObject({
      code: "payer_not_allowed",
      field: "payerPublicKey",
      received: OTHER_PAYER
    });
  });

  it("replaces a provisional PAY with BLOCK when the atomic daily cap loses admission", async () => {
    const context = createContext({ pinned: true, dailyCap: "150" });
    const first = await postCheck(context.app, checkBody({ nonce: "d".repeat(64) }), "cap-first").expect(201);
    expect(first.body.check.decision.verdict).toBe("pay");

    const second = await postCheck(context.app, checkBody({ nonce: "e".repeat(64) }), "cap-second").expect(201);

    expect(second.body.check.decision.verdict).toBe("block");
    expect(reasonCodes(second.body.check)).toContain("policy_daily_cap_exceeded");
    expect(context.repository.getReservation(second.body.check.id)).toBeNull();
  });

  it("cancels an unused PAY reservation and permits the unused nonce again", async () => {
    const context = createContext({ pinned: true });
    const body = checkBody({ nonce: "f".repeat(64) });
    const first = await postCheck(context.app, body, "cancel-first").expect(201);

    await request(context.app)
      .post(`/v1/checks/${first.body.check.id}/cancel`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .send()
      .expect(200);
    expect(context.repository.getReservation(first.body.check.id)?.status).toBe("released");

    const second = await postCheck(context.app, body, "cancel-second").expect(201);
    expect(second.body.check.decision.verdict).toBe("pay");
  });

  it("retrieves a private check after closing and reopening the SQLite database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentpay-check-restart-"));
    tempDirectories.push(directory);
    const databasePath = join(directory, "auditor.sqlite");
    const first = createContext({ pinned: true, databasePath });
    const created = await postCheck(first.app, checkBody(), "restart-check").expect(201);
    first.repository.close();
    openRepositories.splice(openRepositories.indexOf(first.repository), 1);

    const reopened = createContext({ databasePath, installControls: false });
    const response = await request(reopened.app)
      .get(`/v1/checks/${created.body.check.id}`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .expect(200);

    expect(response.body.check).toEqual(created.body.check);
  });

  it("returns a stable validation error for malformed x402 input", async () => {
    const context = createContext({ pinned: true });
    const body = checkBody();
    body.paymentRequired.x402Version = 1;

    const response = await postCheck(context.app, body, "bad-x402").expect(400);

    expect(response.body).toMatchObject({
      code: "invalid_payment_required",
      retryable: false,
      field: "paymentRequired"
    });
  });
});

type ContextOptions = {
  pinned?: boolean;
  dailyCap?: string;
  databasePath?: string;
  installControls?: boolean;
  advanceClockDuringEvidence?: boolean;
};

function createContext(options: ContextOptions = {}) {
  const repository = openSqliteRepository(options.databasePath ?? ":memory:", { now: () => new Date(NOW) });
  openRepositories.push(repository);
  let evidenceCallCount = 0;
  let serviceTime = Date.parse(NOW);
  const evidenceLoader = {
    async loadPaymentAssetEvidence(): Promise<PaymentAssetEvidence> {
      evidenceCallCount += 1;
      if (options.advanceClockDuringEvidence) serviceTime += 50;
      return paymentEvidence(new Date(serviceTime).toISOString());
    }
  };
  if (options.installControls !== false) {
    repository.savePolicy(policy(options.dailyCap ?? "1000000"));
    repository.saveAgentToken({
      id: "agent-token-1",
      operatorPublicKey: OPERATOR,
      agentName: "checkout-agent",
      tokenHash: hashBearerToken(AGENT_TOKEN),
      scopes: ["checks:write", "settlements:write", "observations:write", "receipts:read"],
      allowedPayerPublicKeys: [PAYER],
      revision: 1,
      actionHash: "1".repeat(64),
      signature: `01${"2".repeat(128)}`,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null
    });
    if (options.pinned) repository.saveProviderDecision(providerPin());
  }
  const auth = new AuditorAuth({ repository, publicOrigin: ORIGIN, now: () => new Date(NOW) });
  const service = new PaymentAuditService({ repository, evidenceLoader, now: () => new Date(serviceTime) });
  const app = createReportApp({ auditorRouter: createAuditorRouter({ repository, auth, service }) });
  return { app, auth, repository, evidenceCalls: () => evidenceCallCount };
}

function postCheck(app: Express, body: ReturnType<typeof checkBody>, idempotencyKey: string) {
  return request(app)
    .post("/v1/checks")
    .set("Authorization", `Bearer ${AGENT_TOKEN}`)
    .set("Idempotency-Key", idempotencyKey)
    .send(body);
}

function checkBody(options: { nonce?: string; payerPublicKey?: string } = {}) {
  const requestInput = {
    method: "POST",
    url: "https://service.example/v1/generate",
    bodyHash: "3".repeat(64),
    bodyBytes: 36,
    capturedAt: NOW,
    adapterVersion: "agent-pay-client/0.1.0"
  };
  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: "http://service.example/v1/generate",
      description: "Generate a test response",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: "exact",
        network: "casper:casper-test",
        asset: ASSET,
        amount: "100",
        payTo: PAYEE,
        maxTimeoutSeconds: 300,
        extra: { name: "Casper X402 Token", version: "1", decimals: "9", symbol: "X402" }
      }
    ]
  };
  const requestValue = normalizeOriginalRequest(requestInput);
  const normalized = normalizePaymentRequired(paymentRequired, requestValue);
  if (!normalized.ok) throw new Error("Test payment requirement did not normalize");
  const authorization = buildAuthorizationIntent({
    terms: normalized.terms,
    payerPublicKey: options.payerPublicKey ?? PAYER,
    nowEpochSeconds: Math.floor(Date.parse(NOW) / 1_000),
    nonce: options.nonce ?? "9".repeat(64)
  });
  return { request: requestInput, paymentRequired, authorization };
}

function policy(dailyCap: string): OperatorPolicy {
  const value: OperatorPolicy = {
    policyId: "policy-1",
    operatorPublicKey: OPERATOR,
    revision: 1,
    issuedAt: NOW,
    effectiveAt: NOW,
    allowedNetworks: ["casper:casper-test"],
    allowedPayerPublicKeys: [PAYER],
    assetDailyCaps: { [ASSET]: dailyCap },
    maximumAuthorizationWindowSeconds: 900,
    maximumConcurrentReservations: 10,
    deniedOrigins: [],
    deniedPayees: [],
    deniedAssets: [],
    evidenceMaxAgeSeconds: 60,
    reviewOnInvestmentAdvisories: false,
    allowPinnedResourceSchemeMismatch: true,
    signatureMessage: "AgentPay Operator Action v1\n{}",
    signature: `01${"4".repeat(128)}`,
    policyHash: ""
  };
  value.policyHash = operatorPolicyHash(value);
  return value;
}

function providerPin(): ProviderDecision {
  const value: ProviderDecision = {
    decisionId: "provider-1",
    kind: "pin",
    operatorPublicKey: OPERATOR,
    revision: 1,
    origin: "https://service.example",
    payee: PAYEE,
    asset: ASSET,
    network: "casper:casper-test",
    resourcePathPrefix: "/v1/",
    perCallCeiling: "1000",
    expiresAt: "2026-07-16T21:00:00.000Z",
    promptedByCheckId: "check-review",
    signatureMessage: "AgentPay Operator Action v1\n{}",
    signature: `01${"5".repeat(128)}`,
    decisionHash: ""
  };
  value.decisionHash = providerDecisionHash(value);
  return value;
}

function paymentEvidence(observedAt = NOW): PaymentAssetEvidence {
  return {
    network: "casper:casper-test",
    packageHash: ASSET,
    packageExists: true,
    activeContractHash: CONTRACT,
    authorizationEntrypoint: true,
    name: "Casper X402 Token",
    symbol: "X402",
    decimals: 9,
    mintBurnEnabled: null,
    publicMintEntrypoint: false,
    holderConcentrationPct: null,
    contractAgeBlocks: null,
    apiVersion: "2.0.0",
    observedBlockHash: null,
    observedBlockHeight: null,
    observedAt,
    missing: [],
    sourceErrors: [],
    evidenceHash: "6".repeat(64)
  };
}

function reasonCodes(check: { decision: { reasons: Array<{ code: string }> } }): string[] {
  return check.decision.reasons.map((reason) => reason.code);
}
