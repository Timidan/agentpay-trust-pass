import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AuthorizationIntent,
  OperatorPolicy,
  OriginalRequest,
  PaymentAssetEvidence,
  PaymentDecision,
  PaymentTerms,
  ProviderDecision,
  PurchaseReceipt,
  SettlementProof
} from "@agent-pay/core";
import {
  openSqliteRepository,
  type SqliteAuditorRepository
} from "../../src/auditor/sqliteRepository.js";
import type {
  AgentTokenRecord,
  AnchorJob,
  AuthChallenge,
  AuthSession,
  ResponseObservation,
  StoredPaymentCheck
} from "../../src/auditor/repository.js";

const NOW = "2026-07-15T21:00:00.000Z";
const LATER = "2026-07-15T22:00:00.000Z";
const OPERATOR = `01${"1".repeat(64)}`;
const PAYER = `01${"2".repeat(64)}`;
const ASSET = "5".repeat(64);
const PAYEE = "6".repeat(64);
const tempDirectories: string[] = [];
const repositories: SqliteAuditorRepository[] = [];

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("openSqliteRepository", () => {
  it("migrates once and persists every audit artifact across a restart", async () => {
    const databasePath = await temporaryDatabasePath();
    const first = open(databasePath);
    const challenge = makeChallenge();
    const session = makeSession();
    const policy = makePolicy();
    const providerDecision = makeProviderDecision();
    const token = makeAgentToken();
    const check = makeCheck("check-restart", "60");
    const settlement = makeSettlement(check.id);
    const observation = makeObservation(check.id);
    const receipt = makeReceipt(check, policy, providerDecision, settlement, observation);
    const anchorJob = makeAnchorJob(receipt.receiptId);

    expect(first.schemaVersion()).toBe(2);
    expect(first.saveChallenge(challenge)).toBe(true);
    expect(first.saveSession(session)).toBe(true);
    expect(first.savePolicy(policy)).toBe(true);
    expect(first.saveProviderDecision(providerDecision)).toBe(true);
    expect(first.saveAgentToken(token)).toBe(true);
    expect(first.saveCheck(check)).toBe(true);
    expect(first.saveSettlement(settlement)).toBe(true);
    expect(first.saveResponseObservation(observation)).toBe(true);
    expect(first.saveReceipt(receipt)).toBe(true);
    expect(first.saveAnchorJob(anchorJob)).toBe(true);
    first.close();
    repositories.splice(repositories.indexOf(first), 1);

    const reopened = open(databasePath);
    expect(reopened.schemaVersion()).toBe(2);
    expect(reopened.getChallenge(challenge.id)).toEqual(challenge);
    expect(reopened.findSessionByTokenHash(session.tokenHash)).toEqual(session);
    expect(reopened.getCurrentPolicy(OPERATOR)).toEqual(policy);
    expect(reopened.listProviderDecisions(OPERATOR)).toEqual([providerDecision]);
    expect(reopened.findAgentTokenByHash(token.tokenHash)).toEqual(token);
    expect(reopened.getCheck(check.id)).toEqual(check);
    expect(reopened.findCheckByIdempotencyKey(OPERATOR, check.idempotencyKey!)).toEqual(check);
    expect(reopened.getSettlement(check.id)).toEqual(settlement);
    expect(reopened.getResponseObservation(check.id)).toEqual(observation);
    expect(reopened.getReceipt(receipt.receiptId)).toEqual(receipt);
    expect(reopened.getReceiptByCheckId(check.id)).toEqual(receipt);
    expect(reopened.getAnchorJob(anchorJob.id)).toEqual(anchorJob);
  });

  it("consumes challenges once and persists session and token revocation", async () => {
    const repository = open(await temporaryDatabasePath());
    const challenge = makeChallenge();
    const session = makeSession();
    const token = makeAgentToken();
    repository.saveChallenge(challenge);
    repository.saveSession(session);
    repository.saveAgentToken(token);

    expect(repository.consumeChallenge(challenge.id, NOW)).toBe(true);
    expect(repository.consumeChallenge(challenge.id, NOW)).toBe(false);
    expect(repository.getChallenge(challenge.id)?.usedAt).toBe(NOW);
    expect(repository.revokeSession(session.id, NOW)).toBe(true);
    expect(repository.revokeSession(session.id, NOW)).toBe(false);
    expect(repository.findSessionByTokenHash(session.tokenHash)?.revokedAt).toBe(NOW);
    const revocation = {
      tokenId: token.id,
      operatorPublicKey: OPERATOR,
      revision: 2,
      actionHash: "e".repeat(64),
      signature: `01${"f".repeat(128)}`,
      revokedAt: NOW
    };
    expect(repository.revokeAgentToken(revocation)).toBe(true);
    expect(repository.revokeAgentToken(revocation)).toBe(false);
    expect(repository.findAgentTokenByHash(token.tokenHash)?.revokedAt).toBe(NOW);
    expect(repository.getAgentTokenRevocation(token.id)).toEqual(revocation);
    expect(repository.latestAgentTokenRevision(OPERATOR)).toBe(2);
  });

  it("keeps signed revisions and check idempotency keys immutable", async () => {
    const repository = open(await temporaryDatabasePath());
    const policy = makePolicy();
    const providerDecision = makeProviderDecision();
    const check = makeCheck("check-immutable", "60");

    expect(repository.savePolicy(policy)).toBe(true);
    expect(repository.savePolicy(policy)).toBe(false);
    expect(repository.latestPolicyRevision(OPERATOR)).toBe(1);
    expect(repository.savePolicy({ ...policy, policyId: "changed", policyHash: "9".repeat(64) })).toBe(false);

    expect(repository.saveProviderDecision(providerDecision)).toBe(true);
    expect(repository.saveProviderDecision(providerDecision)).toBe(false);
    expect(repository.latestProviderDecisionRevision(OPERATOR)).toBe(1);

    expect(repository.saveCheck(check)).toBe(true);
    expect(repository.saveCheck(check)).toBe(false);
    expect(repository.saveCheck({ ...check, id: "different-id" })).toBe(false);
  });

  it("reserves atomically, enforces the daily cap, and remains idempotent", async () => {
    const databasePath = await temporaryDatabasePath();
    const first = open(databasePath);
    const firstCheck = makeCheck("check-cap-1", "60");
    const secondCheck = makeCheck("check-cap-2", "60", "idempotency-2");
    first.saveCheck(firstCheck);
    first.saveCheck(secondCheck);

    const reservation = {
      checkId: firstCheck.id,
      operatorPublicKey: OPERATOR,
      asset: ASSET,
      amount: "60",
      dailyCap: "100",
      maximumConcurrentReservations: 10,
      expiresAt: LATER
    };
    expect(first.reserve(reservation)).toEqual({ ok: true });
    expect(first.reserve(reservation)).toEqual({ ok: true });
    expect(
      first.reserve({ ...reservation, checkId: secondCheck.id })
    ).toEqual({ ok: false, reason: "policy_daily_cap_exceeded" });
    expect(first.reservedTotal(OPERATOR, ASSET, "2026-07-15")).toBe("60");
    first.close();
    repositories.splice(repositories.indexOf(first), 1);

    const reopened = open(databasePath);
    expect(reopened.reservedTotal(OPERATOR, ASSET, "2026-07-15")).toBe("60");
    expect(reopened.getReservation(firstCheck.id)).toMatchObject({
      checkId: firstCheck.id,
      amount: "60",
      status: "active"
    });
  });

  it("serializes cap admission across two repository connections", async () => {
    const databasePath = await temporaryDatabasePath();
    const first = open(databasePath);
    const second = open(databasePath);
    const firstCheck = makeCheck("check-race-1", "60");
    const secondCheck = makeCheck("check-race-2", "60", "idempotency-race-2");
    first.saveCheck(firstCheck);
    second.saveCheck(secondCheck);

    expect(first.reserve(reservationFor(firstCheck.id, "60", "100"))).toEqual({ ok: true });
    expect(second.reserve(reservationFor(secondCheck.id, "60", "100"))).toEqual({
      ok: false,
      reason: "policy_daily_cap_exceeded"
    });
    expect(second.reservedTotal(OPERATOR, ASSET, "2026-07-15")).toBe("60");
  });

  it("expires unused reservations before admitting a later payment", async () => {
    let now = new Date(NOW);
    const repository = open(await temporaryDatabasePath(), () => now);
    const firstCheck = makeCheck("check-expire-1", "60");
    const secondCheck = makeCheck("check-expire-2", "70", "idempotency-expire-2");
    repository.saveCheck(firstCheck);
    repository.saveCheck(secondCheck);

    expect(repository.reserve(reservationFor(firstCheck.id, "60", "100", "2026-07-15T21:01:00.000Z")))
      .toEqual({ ok: true });
    now = new Date("2026-07-15T21:02:00.000Z");
    expect(repository.reserve(reservationFor(secondCheck.id, "70", "100", LATER)))
      .toEqual({ ok: true });
    expect(repository.getReservation(firstCheck.id)?.status).toBe("expired");
    expect(repository.reservedTotal(OPERATOR, ASSET, "2026-07-15")).toBe("70");
  });

  it("sums atomic-unit strings without SQLite or JavaScript number coercion", async () => {
    const repository = open(await temporaryDatabasePath());
    const amount = "900719925474099312345678901234567890";
    const cap = "1801439850948198624691357802469135780";
    const firstCheck = makeCheck("check-bigint-1", amount);
    const secondCheck = makeCheck("check-bigint-2", amount, "idempotency-bigint-2");
    repository.saveCheck(firstCheck);
    repository.saveCheck(secondCheck);

    expect(repository.reserve(reservationFor(firstCheck.id, amount, cap))).toEqual({ ok: true });
    expect(repository.reserve(reservationFor(secondCheck.id, amount, cap))).toEqual({ ok: true });
    expect(repository.reservedTotal(OPERATOR, ASSET, "2026-07-15")).toBe(
      "1801439850948198624691357802469135780"
    );
  });

  it("enforces concurrent reservation limits and valid reservation transitions", async () => {
    const repository = open(await temporaryDatabasePath());
    const firstCheck = makeCheck("check-state-1", "60");
    const secondCheck = makeCheck("check-state-2", "10", "idempotency-state-2");
    repository.saveCheck(firstCheck);
    repository.saveCheck(secondCheck);

    expect(repository.reserve({ ...reservationFor(firstCheck.id, "60", "100"), maximumConcurrentReservations: 1 }))
      .toEqual({ ok: true });
    expect(repository.reserve({ ...reservationFor(secondCheck.id, "10", "100"), maximumConcurrentReservations: 1 }))
      .toEqual({ ok: false, reason: "maximum_concurrent_reservations" });
    expect(repository.transitionReservation(firstCheck.id, "consumed", NOW)).toBe(true);
    expect(repository.transitionReservation(firstCheck.id, "released", NOW)).toBe(false);
    expect(repository.reservedTotal(OPERATOR, ASSET, "2026-07-15")).toBe("0");
    expect(repository.spentTotal(OPERATOR, ASSET, "2026-07-15")).toBe("60");
  });

  it("updates anchor jobs without mutating immutable receipts", async () => {
    const repository = open(await temporaryDatabasePath());
    const check = makeCheck("check-anchor", "60");
    const policy = makePolicy();
    const providerDecision = makeProviderDecision();
    const settlement = makeSettlement(check.id);
    const observation = makeObservation(check.id);
    const receipt = makeReceipt(check, policy, providerDecision, settlement, observation);
    const anchorJob = makeAnchorJob(receipt.receiptId);
    repository.saveCheck(check);
    repository.saveReceipt(receipt);
    repository.saveAnchorJob(anchorJob);

    const updated: AnchorJob = {
      ...anchorJob,
      status: "submitted",
      attempts: 1,
      transactionHash: "8".repeat(64),
      updatedAt: LATER
    };
    expect(repository.updateAnchorJob(updated)).toBe(true);
    expect(repository.getAnchorJob(anchorJob.id)).toEqual(updated);
    expect(repository.saveReceipt({ ...receipt, receiptHash: "0".repeat(64) })).toBe(false);
    expect(repository.getReceipt(receipt.receiptId)).toEqual(receipt);
  });
});

function open(path: string, now: () => Date = () => new Date(NOW)): SqliteAuditorRepository {
  const repository = openSqliteRepository(path, { now });
  repositories.push(repository);
  return repository;
}

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentpay-sqlite-"));
  tempDirectories.push(directory);
  return join(directory, "auditor.sqlite");
}

function reservationFor(checkId: string, amount: string, dailyCap: string, expiresAt = LATER) {
  return {
    checkId,
    operatorPublicKey: OPERATOR,
    asset: ASSET,
    amount,
    dailyCap,
    maximumConcurrentReservations: 10,
    expiresAt
  };
}

function makeChallenge(): AuthChallenge {
  return {
    id: "challenge-1",
    operatorPublicKey: OPERATOR,
    origin: "https://agentpay.example",
    purpose: "session",
    nonce: "a".repeat(64),
    action: "session:create",
    issuedAt: NOW,
    expiresAt: LATER,
    usedAt: null
  };
}

function makeSession(): AuthSession {
  return {
    id: "session-1",
    operatorPublicKey: OPERATOR,
    tokenHash: "b".repeat(64),
    origin: "https://agentpay.example",
    createdAt: NOW,
    expiresAt: LATER,
    revokedAt: null
  };
}

function makeAgentToken(): AgentTokenRecord {
  return {
    id: "token-1",
    operatorPublicKey: OPERATOR,
    agentName: "test-agent",
    tokenHash: "c".repeat(64),
    scopes: ["checks:write", "settlements:write", "observations:write", "receipts:read"],
    allowedPayerPublicKeys: [PAYER],
    revision: 1,
    actionHash: "d".repeat(64),
    signature: `01${"e".repeat(128)}`,
    createdAt: NOW,
    expiresAt: null,
    revokedAt: null
  };
}

function makePolicy(): OperatorPolicy {
  return {
    policyId: "policy-1",
    operatorPublicKey: OPERATOR,
    revision: 1,
    issuedAt: NOW,
    effectiveAt: NOW,
    allowedNetworks: ["casper:casper-test"],
    allowedPayerPublicKeys: [PAYER],
    assetDailyCaps: { [ASSET]: "1000000" },
    maximumAuthorizationWindowSeconds: 900,
    maximumConcurrentReservations: 10,
    deniedOrigins: [],
    deniedPayees: [],
    deniedAssets: [],
    evidenceMaxAgeSeconds: 60,
    reviewOnInvestmentAdvisories: false,
    allowPinnedResourceSchemeMismatch: true,
    signature: `01${"e".repeat(128)}`,
    policyHash: "f".repeat(64)
  };
}

function makeProviderDecision(): ProviderDecision {
  return {
    decisionId: "provider-1",
    kind: "pin",
    operatorPublicKey: OPERATOR,
    revision: 1,
    origin: "https://tab402.fly.dev",
    payee: PAYEE,
    asset: ASSET,
    network: "casper:casper-test",
    resourcePathPrefix: "/v1/",
    perCallCeiling: "1000",
    expiresAt: "2026-07-16T21:00:00.000Z",
    promptedByCheckId: "check-review",
    signature: `01${"a".repeat(128)}`,
    decisionHash: "1".repeat(64)
  };
}

function makeCheck(id: string, amount: string, idempotencyKey = `idempotency-${id}`): StoredPaymentCheck {
  const request = makeRequest();
  const terms = makeTerms(amount);
  const authorization = makeAuthorization(amount);
  const evidence = makeEvidence();
  const decision = makeDecision(id, amount);
  return {
    id,
    operatorPublicKey: OPERATOR,
    agentTokenId: "token-1",
    payerPublicKey: PAYER,
    idempotencyKey,
    request,
    terms,
    authorization,
    evidence,
    policy: makePolicy(),
    providerDecision: makeProviderDecision(),
    decision,
    status: "reserved",
    createdAt: NOW,
    updatedAt: NOW
  };
}

function makeRequest(): OriginalRequest {
  return {
    method: "POST",
    url: "https://tab402.fly.dev/v1/speak",
    scheme: "https",
    origin: "https://tab402.fly.dev",
    path: "/v1/speak",
    bodyHash: "2".repeat(64),
    bodyBytes: 36,
    capturedAt: NOW,
    adapterVersion: "test",
    requestHash: "3".repeat(64)
  };
}

function makeTerms(amount: string): PaymentTerms {
  return {
    x402Version: 2,
    acceptanceIndex: 0,
    scheme: "exact",
    network: "casper:casper-test",
    asset: ASSET,
    amount,
    payTo: PAYEE,
    maxTimeoutSeconds: 300,
    resource: {
      url: "http://tab402.fly.dev/v1/speak",
      description: "Speech service",
      mimeType: "application/json"
    },
    resourceComparison: { sameHost: true, sameScheme: false, samePath: true },
    extra: { name: "Casper X402 Token", version: "1", decimals: "9", symbol: "X402" },
    requirementHash: "4".repeat(64)
  };
}

function makeAuthorization(amount: string): AuthorizationIntent {
  return {
    payerPublicKey: PAYER,
    from: "7".repeat(64),
    to: PAYEE,
    amount,
    validAfter: "1784148600",
    validBefore: "1784149500",
    nonce: "8".repeat(64),
    network: "casper:casper-test",
    asset: ASSET,
    tokenName: "Casper X402 Token",
    tokenVersion: "1",
    digest: "9".repeat(64)
  };
}

function makeEvidence(): PaymentAssetEvidence {
  return {
    network: "casper:casper-test",
    packageHash: ASSET,
    packageExists: true,
    activeContractHash: "a".repeat(64),
    authorizationEntrypoint: true,
    name: "Casper X402 Token",
    symbol: "X402",
    decimals: 9,
    mintAuthorityOpen: null,
    supplyMutable: null,
    holderConcentrationPct: null,
    contractAgeBlocks: null,
    apiVersion: "2.0.0",
    observedBlockHash: null,
    observedBlockHeight: null,
    observedAt: NOW,
    missing: [],
    sourceErrors: [],
    evidenceHash: "b".repeat(64)
  };
}

function makeDecision(checkId: string, amount: string): PaymentDecision {
  return {
    checkId,
    verdict: "pay",
    basis: "operator_pinned",
    reasons: [],
    advisories: [],
    policyHash: "f".repeat(64),
    authorizationDigest: "9".repeat(64),
    reservation: { amount, expiresAt: LATER },
    decidedAt: NOW,
    decisionHash: "c".repeat(64)
  };
}

function makeSettlement(checkId: string): SettlementProof {
  return {
    checkId,
    transactionHash: "d".repeat(64),
    verdict: "match",
    reasons: [],
    rpcEndpoint: "https://node.testnet.casper.network/rpc",
    blockHash: "e".repeat(64),
    blockHeight: 7_654_321,
    observedAt: NOW,
    decoded: { amount: "60" },
    proofHash: "f".repeat(64)
  };
}

function makeObservation(checkId: string): ResponseObservation {
  return {
    checkId,
    observerVersion: "agent-pay-client/0.1.0",
    status: 200,
    contentType: "application/json",
    bodyBytes: 42,
    bodyHash: "1".repeat(64),
    observedAt: NOW,
    observationHash: "2".repeat(64)
  };
}

function makeReceipt(
  check: StoredPaymentCheck,
  policy: OperatorPolicy,
  providerDecision: ProviderDecision,
  settlement: SettlementProof,
  observation: ResponseObservation
): PurchaseReceipt {
  return {
    schemaVersion: "agentpay-purchase/v1",
    receiptId: `receipt-${check.id}`,
    checkId: check.id,
    request: check.request,
    terms: check.terms,
    evidence: check.evidence,
    policy,
    providerDecision,
    decision: check.decision,
    authorization: check.authorization!,
    settlement,
    response: {
      observerVersion: observation.observerVersion,
      status: observation.status,
      contentType: observation.contentType,
      bodyBytes: observation.bodyBytes,
      bodyHash: observation.bodyHash,
      observedAt: observation.observedAt
    },
    anchor: { status: "pending", transactionHash: null },
    createdAt: NOW,
    receiptHash: "3".repeat(64)
  };
}

function makeAnchorJob(receiptId: string): AnchorJob {
  return {
    id: "anchor-1",
    receiptId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: NOW,
    transactionHash: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW
  };
}
