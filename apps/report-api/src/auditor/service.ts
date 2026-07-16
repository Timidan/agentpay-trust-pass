import { randomBytes, randomUUID } from "node:crypto";
import {
  artifactHash,
  buildPurchaseReceipt,
  compareSettlement,
  evaluatePayment,
  normalizeOriginalRequest,
  normalizePaymentRequired,
  parseCasperPublicKey,
  type AuthorizationIntent,
  type OriginalRequestInput,
  type PaymentAssetEvidence,
  type PaymentDecision,
  type PaymentTerms,
  type ProviderDecision,
  type PurchaseReceipt,
  type Reason,
  type ReasonCode,
  type SettlementProof
} from "@agent-pay/core";
import { AuthError, hashBearerToken } from "./auth.js";
import { createReceiptAnchorJob, type ReceiptAnchorPublisher } from "./registry.js";
import type {
  AuditorRepository,
  ReceiptShareRecord,
  ResponseObservation,
  ReservationResult,
  StoredPaymentCheck
} from "./repository.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^(?:(?:00|01)[0-9a-f]{64}|02[0-9a-f]{66})$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const MAX_RECEIPT_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type PaymentEvidenceLoader = {
  loadPaymentAssetEvidence(input: {
    network: "casper:casper-test";
    packageHash: string;
    declaredMetadata: {
      name: string;
      symbol: string | null;
      decimals: string | null;
    };
  }): Promise<PaymentAssetEvidence>;
};

export type PaymentAuditServiceOptions = {
  repository: AuditorRepository;
  evidenceLoader: PaymentEvidenceLoader;
  settlementLoader?: PaymentSettlementLoader;
  anchorPublisher?: ReceiptAnchorScheduler;
  now?: () => Date;
};

export type ReceiptAnchorScheduler = Pick<ReceiptAnchorPublisher, "enqueue" | "wake">;

export type PaymentSettlementLoader = {
  rpcUrl: string;
  getTransaction(hash: string, signal?: AbortSignal): Promise<unknown>;
};

export type CreateCheckInput = {
  operatorPublicKey: string;
  agentTokenId: string | null;
  idempotencyKey: string;
  request: unknown;
  paymentRequired: unknown;
  authorization: unknown;
};

export class PaymentAuditService {
  private readonly repository: AuditorRepository;
  private readonly evidenceLoader: PaymentEvidenceLoader;
  private readonly settlementLoader: PaymentSettlementLoader | null;
  private readonly anchorPublisher: ReceiptAnchorScheduler | null;
  private readonly now: () => Date;

  constructor(options: PaymentAuditServiceOptions) {
    this.repository = options.repository;
    this.evidenceLoader = options.evidenceLoader;
    this.settlementLoader = options.settlementLoader ?? null;
    this.anchorPublisher = options.anchorPublisher ?? null;
    this.now = options.now ?? (() => new Date());
  }

  async createCheck(input: CreateCheckInput): Promise<{ created: boolean; check: StoredPaymentCheck }> {
    const request = parseOriginalRequest(input.request);
    const normalization = normalizePaymentRequired(input.paymentRequired, request);
    if (!normalization.ok) {
      throw new AuthError(
        "invalid_payment_required",
        normalization.reasons.map((reason) => reason.message).join("; "),
        400,
        {
          field: "paymentRequired",
          expected: "one supported Casper x402 v2 exact acceptance",
          received: normalization.reasons
        }
      );
    }
    const authorization = parseAuthorizationIntent(input.authorization);
    const operatorPublicKey = parseCasperPublicKey(input.operatorPublicKey).publicKeyHex;

    const existing = this.repository.findCheckByIdempotencyKey(operatorPublicKey, input.idempotencyKey);
    if (existing) {
      ensureIdempotentMatch(existing, input.agentTokenId, normalization.terms, request.requestHash, authorization);
      return { created: false, check: existing };
    }

    const evidence = await this.evidenceLoader.loadPaymentAssetEvidence({
      network: normalization.terms.network,
      packageHash: normalization.terms.asset,
      declaredMetadata: {
        name: normalization.terms.extra.name,
        symbol: normalization.terms.extra.symbol,
        decimals: normalization.terms.extra.decimals
      }
    });
    const now = this.nowDate();
    const policy = this.repository.getCurrentPolicy(operatorPublicKey);
    const providerDecision = selectProviderDecision(
      this.repository.listProviderDecisions(operatorPublicKey),
      normalization.request.origin,
      normalization.request.path,
      normalization.terms
    );
    const utcDay = now.toISOString().slice(0, 10);
    const replayedNonces =
      authorization &&
      this.repository.authorizationReplayUsed(
        operatorPublicKey,
        normalization.terms.asset,
        authorization.payerPublicKey,
        authorization.nonce
      )
        ? [authorization.nonce]
        : [];
    let decision = evaluatePayment({
      checkId: randomUUID(),
      request: normalization.request,
      terms: normalization.terms,
      authorization,
      evidence,
      policy,
      providerDecision,
      spent: this.repository.spentTotal(operatorPublicKey, normalization.terms.asset, utcDay),
      reserved: this.repository.reservedTotal(operatorPublicKey, normalization.terms.asset, utcDay),
      replayedNonces,
      activeReservations: this.repository.activeReservationCount(operatorPublicKey),
      now: now.toISOString()
    });
    let check = buildStoredCheck({
      input,
      operatorPublicKey,
      request: normalization.request,
      terms: normalization.terms,
      authorization,
      evidence,
      policy,
      providerDecision,
      decision,
      now: now.toISOString()
    });

    if (decision.verdict === "pay") {
      if (!authorization || !policy || !decision.reservation) {
        throw new Error("PAY decision omitted mandatory authorization, policy, or reservation data");
      }
      const dailyCap = policy.assetDailyCaps[normalization.terms.asset];
      if (dailyCap === undefined) throw new Error("PAY decision omitted its signed asset cap");
      const reservation = this.repository.saveCheckAndReserve(check, {
        checkId: check.id,
        operatorPublicKey,
        asset: normalization.terms.asset,
        amount: normalization.terms.amount,
        dailyCap,
        maximumConcurrentReservations: policy.maximumConcurrentReservations,
        payerPublicKey: authorization.payerPublicKey,
        nonce: authorization.nonce,
        expiresAt: decision.reservation.expiresAt
      });
      if (!reservation.ok && reservation.reason === "check_conflict") {
        return {
          created: false,
          check: this.requireIdempotentRace(
            operatorPublicKey,
            input,
            normalization.terms,
            request.requestHash,
            authorization
          )
        };
      }
      if (!reservation.ok) {
        decision = blockReservationFailure(decision, reservation);
        check = {
          ...check,
          decision,
          status: "blocked",
          updatedAt: now.toISOString()
        };
        if (!this.repository.saveCheck(check)) {
          return {
            created: false,
            check: this.requireIdempotentRace(
              operatorPublicKey,
              input,
              normalization.terms,
              request.requestHash,
              authorization
            )
          };
        }
      }
    } else if (!this.repository.saveCheck(check)) {
      return {
        created: false,
        check: this.requireIdempotentRace(
          operatorPublicKey,
          input,
          normalization.terms,
          request.requestHash,
          authorization
        )
      };
    }

    return { created: true, check };
  }

  getCheck(checkId: string): StoredPaymentCheck | null {
    return this.repository.getCheck(checkId);
  }

  cancelCheck(checkId: string): StoredPaymentCheck {
    const check = this.repository.getCheck(checkId);
    if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
    if (check.status !== "reserved") {
      throw new AuthError("check_not_cancellable", "Only an unused PAY reservation can be cancelled", 409, {
        field: "check.status",
        expected: "reserved",
        received: check.status
      });
    }
    const now = this.nowDate().toISOString();
    if (!this.repository.transitionReservation(check.id, "released", now)) {
      throw new AuthError("check_not_cancellable", "Payment reservation is no longer active", 409);
    }
    const cancelled: StoredPaymentCheck = { ...check, status: "cancelled", updatedAt: now };
    if (!this.repository.updateCheck(cancelled)) {
      throw new AuthError("check_persistence_failed", "Cancelled check state could not be persisted", 503, { retryable: true });
    }
    return cancelled;
  }

  async verifySettlement(
    checkId: string,
    transactionHashValue: unknown
  ): Promise<{ created: boolean; check: StoredPaymentCheck; proof: SettlementProof; receipt: PurchaseReceipt | null }> {
    const transactionHash = parseHash(transactionHashValue, "transactionHash");
    const check = this.repository.getCheck(checkId);
    if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
    if (check.decision.verdict !== "pay" || !check.authorization) {
      throw new AuthError("settlement_not_allowed", "Only a PAY check can verify a settlement", 409, {
        field: "check.decision.verdict",
        expected: "pay",
        received: check.decision.verdict
      });
    }

    const existing = this.repository.getSettlement(check.id);
    if (existing && (existing.verdict === "match" || existing.verdict === "mismatch")) {
      if (existing.transactionHash !== transactionHash) throw settlementConflict(existing.transactionHash, transactionHash);
      return {
        created: false,
        check,
        proof: existing,
        receipt: this.repository.getReceiptByCheckId(check.id)
      };
    }
    if (existing && existing.transactionHash !== transactionHash) {
      throw settlementConflict(existing.transactionHash, transactionHash);
    }
    if (!["reserved", "settlement_pending", "settlement_unverifiable"].includes(check.status)) {
      throw new AuthError("settlement_not_allowed", "Payment check cannot accept a settlement in its current state", 409, {
        field: "check.status",
        expected: ["reserved", "settlement_pending", "settlement_unverifiable"],
        received: check.status
      });
    }
    if (!this.settlementLoader) {
      throw new AuthError("settlement_rpc_unavailable", "Casper settlement verification is not configured", 503, {
        retryable: true
      });
    }

    const observedAt = this.nowDate().toISOString();
    let rpcResult: unknown;
    try {
      rpcResult = await this.settlementLoader.getTransaction(transactionHash);
    } catch {
      rpcResult = { error: { code: "transport_error", message: "Casper RPC request failed" } };
    }
    const proof = compareSettlement({
      checkId: check.id,
      transactionHash,
      approved: check.authorization,
      rpcEnvelope: rpcResult,
      rpcEndpoint: this.settlementLoader.rpcUrl,
      observedAt
    });
    const updatedCheck: StoredPaymentCheck = {
      ...check,
      status: settlementCheckStatus(proof),
      updatedAt: observedAt
    };
    const reservationStatus = proof.verdict === "match"
      ? "consumed" as const
      : proof.verdict === "mismatch"
        ? "quarantined" as const
        : null;
    const persisted = this.repository.applySettlement(updatedCheck, proof, reservationStatus);
    if (!persisted.ok) {
      if (persisted.reason === "transaction_conflict") throw settlementConflict(existing?.transactionHash ?? null, transactionHash);
      throw new AuthError(
        persisted.reason === "check_not_found" ? "check_not_found" : "settlement_conflict",
        persisted.reason === "check_not_found"
          ? "Payment check was not found"
          : "Payment settlement state changed before verification completed",
        persisted.reason === "check_not_found" ? 404 : 409,
        { field: "settlement", expected: "current PAY reservation", received: persisted.reason }
      );
    }
    const storedCheck = this.repository.getCheck(check.id);
    if (!storedCheck) throw new AuthError("check_not_found", "Payment check was not found", 404);
    return {
      created: persisted.created,
      check: storedCheck,
      proof: persisted.settlement,
      receipt: this.repository.getReceiptByCheckId(check.id)
    };
  }

  recordResponseObservation(
    checkId: string,
    input: unknown
  ): { created: boolean; observation: ResponseObservation; receipt: PurchaseReceipt } {
    const check = this.repository.getCheck(checkId);
    if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
    const settlement = this.repository.getSettlement(check.id);
    if (check.status !== "settled" || !settlement || settlement.verdict !== "match") {
      throw new AuthError("settlement_required", "A matching settlement is required before recording the response", 409, {
        field: "check.status",
        expected: "settled",
        received: check.status
      });
    }

    const now = this.nowDate();
    const observation = parseResponseObservation(check.id, input, now);
    const existingObservation = this.repository.getResponseObservation(check.id);
    const existingReceipt = this.repository.getReceiptByCheckId(check.id);
    if (existingObservation && existingObservation.observationHash !== observation.observationHash) {
      throw observationConflict(existingObservation.observationHash, observation.observationHash);
    }
    if (existingObservation && existingReceipt) {
      this.anchorPublisher?.enqueue(existingReceipt);
      return { created: false, observation: existingObservation, receipt: existingReceipt };
    }
    if (!check.policy || !check.providerDecision || !check.authorization) {
      throw new AuthError("receipt_state_invalid", "PAY check is missing signed receipt artifacts", 500);
    }

    const response = {
      observerVersion: observation.observerVersion,
      status: observation.status,
      contentType: observation.contentType,
      bodyBytes: observation.bodyBytes,
      bodyHash: observation.bodyHash,
      observedAt: observation.observedAt
    };
    const receipt = buildPurchaseReceipt({
      receiptId: `receipt-${check.id}`,
      checkId: check.id,
      request: check.request,
      terms: check.terms,
      evidence: check.evidence,
      policy: check.policy,
      providerDecision: check.providerDecision,
      decision: check.decision,
      authorization: check.authorization,
      settlement,
      response,
      anchor: { status: "off_chain_verified", transactionHash: null },
      createdAt: now.toISOString()
    });
    const anchorJob = this.anchorPublisher ? createReceiptAnchorJob(receipt, now) : undefined;
    const persisted = this.repository.saveObservationAndReceipt(observation, receipt, anchorJob);
    if (!persisted.ok) {
      if (persisted.reason === "observation_conflict") {
        throw observationConflict(
          this.repository.getResponseObservation(check.id)?.observationHash ?? null,
          observation.observationHash
        );
      }
      throw new AuthError(
        persisted.reason === "check_not_found" ? "check_not_found" : "receipt_conflict",
        persisted.reason === "check_not_found"
          ? "Payment check was not found"
          : "Receipt state changed before it could be persisted",
        persisted.reason === "check_not_found" ? 404 : 409,
        { field: "receipt", expected: "one immutable receipt", received: persisted.reason }
      );
    }
    const storedObservation = this.repository.getResponseObservation(check.id);
    const storedReceipt = this.repository.getReceiptByCheckId(check.id);
    if (!storedObservation || !storedReceipt) {
      throw new AuthError("receipt_state_invalid", "Persisted receipt could not be reloaded", 500);
    }
    this.anchorPublisher?.wake();
    return { created: persisted.created, observation: storedObservation, receipt: storedReceipt };
  }

  getReceipt(receiptId: string): PurchaseReceipt | null {
    return this.repository.getReceipt(receiptId);
  }

  getReceiptAnchorState(receiptId: string): PurchaseReceipt["anchor"] {
    const job = this.repository.getAnchorJob(`anchor-${receiptId}`);
    if (!job) return { status: "off_chain_verified", transactionHash: null };
    if (job.status === "confirmed") return { status: "anchored", transactionHash: job.transactionHash };
    if (job.status === "failed") return { status: "failed", transactionHash: job.transactionHash };
    return { status: "pending", transactionHash: job.transactionHash };
  }

  createReceiptShare(
    receiptId: string,
    operatorPublicKey: string,
    expiresAtValue: unknown
  ): { token: string; share: Omit<ReceiptShareRecord, "tokenHash"> } {
    this.requireOwnedReceipt(receiptId, operatorPublicKey);
    const now = this.nowDate();
    const expiresAt = canonicalTimestamp(expiresAtValue, "expiresAt");
    const expiresAtMs = Date.parse(expiresAt);
    if (expiresAtMs <= now.getTime() || expiresAtMs - now.getTime() > MAX_RECEIPT_SHARE_TTL_MS) {
      throw invalidRequest("expiresAt", "future timestamp no more than 30 days away", expiresAt);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const record: ReceiptShareRecord = {
        id: randomUUID(),
        receiptId,
        operatorPublicKey,
        tokenHash: hashBearerToken(token),
        createdAt: now.toISOString(),
        expiresAt,
        revokedAt: null
      };
      if (this.repository.saveReceiptShare(record)) {
        const { tokenHash: _tokenHash, ...share } = record;
        return { token, share };
      }
    }
    throw new AuthError("receipt_share_conflict", "Could not create a unique receipt share", 409);
  }

  getSharedReceipt(receiptId: string, token: unknown): PurchaseReceipt | null {
    if (typeof token !== "string") return null;
    let tokenHash: string;
    try {
      tokenHash = hashBearerToken(token);
    } catch {
      return null;
    }
    const share = this.repository.findReceiptShareByTokenHash(receiptId, tokenHash);
    if (!share || share.revokedAt !== null || Date.parse(share.expiresAt) <= this.nowDate().getTime()) {
      return null;
    }
    return this.repository.getReceipt(receiptId);
  }

  revokeReceiptShare(receiptId: string, shareId: string, operatorPublicKey: string): void {
    this.requireOwnedReceipt(receiptId, operatorPublicKey);
    const share = this.repository.getReceiptShare(shareId);
    if (!share || share.receiptId !== receiptId || share.operatorPublicKey !== operatorPublicKey) {
      throw new AuthError("receipt_share_not_found", "Receipt share was not found", 404);
    }
    if (share.revokedAt !== null) {
      throw new AuthError("receipt_share_revoked", "Receipt share has already been revoked", 409);
    }
    if (!this.repository.revokeReceiptShare(share.id, operatorPublicKey, this.nowDate().toISOString())) {
      throw new AuthError("receipt_share_revoked", "Receipt share has already been revoked", 409);
    }
  }

  private requireIdempotentRace(
    operatorPublicKey: string,
    input: CreateCheckInput,
    terms: PaymentTerms,
    requestHash: string,
    authorization: AuthorizationIntent | null
  ): StoredPaymentCheck {
    const raced = this.repository.findCheckByIdempotencyKey(operatorPublicKey, input.idempotencyKey);
    if (!raced) {
      throw new AuthError("check_persistence_failed", "Payment check could not be persisted", 503, {
        retryable: true
      });
    }
    ensureIdempotentMatch(raced, input.agentTokenId, terms, requestHash, authorization);
    return raced;
  }

  private requireOwnedReceipt(receiptId: string, operatorPublicKey: string): PurchaseReceipt {
    const receipt = this.repository.getReceipt(receiptId);
    if (!receipt) throw new AuthError("receipt_not_found", "Purchase receipt was not found", 404);
    const check = this.repository.getCheck(receipt.checkId);
    if (!check || check.operatorPublicKey !== operatorPublicKey) {
      throw new AuthError("receipt_not_found", "Purchase receipt was not found", 404);
    }
    return receipt;
  }

  private nowDate(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError("Payment audit service clock returned an invalid date");
    }
    return value;
  }
}

function parseOriginalRequest(value: unknown) {
  const input = asRecord(value);
  if (!input) throw invalidRequest("request", "object", value);
  try {
    return normalizeOriginalRequest({
      method: stringField(input.method, "request.method"),
      url: stringField(input.url, "request.url"),
      bodyHash: stringField(input.bodyHash, "request.bodyHash"),
      bodyBytes: numberField(input.bodyBytes, "request.bodyBytes"),
      capturedAt: stringField(input.capturedAt, "request.capturedAt"),
      adapterVersion: stringField(input.adapterVersion, "request.adapterVersion")
    } satisfies OriginalRequestInput);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("invalid_request", error instanceof Error ? error.message : "Original request is invalid", 400, {
      field: "request",
      expected: "normalized request metadata",
      received: value
    });
  }
}

export function parseAuthorizationIntent(value: unknown): AuthorizationIntent | null {
  if (value === null || value === undefined) return null;
  const input = asRecord(value);
  if (!input) throw invalidRequest("authorization", "object or null", value);
  const payerPublicKey = parsePublicKey(input.payerPublicKey, "authorization.payerPublicKey");
  const validAfter = safeTimestampInteger(input.validAfter, "authorization.validAfter");
  const validBefore = safeTimestampInteger(input.validBefore, "authorization.validBefore");
  return {
    payerPublicKey,
    from: address(input.from, "authorization.from"),
    to: address(input.to, "authorization.to"),
    amount: decimal(input.amount, "authorization.amount", false),
    validAfter,
    validBefore,
    nonce: hash(input.nonce, "authorization.nonce"),
    network: network(input.network, "authorization.network"),
    asset: hash(input.asset, "authorization.asset"),
    tokenName: boundedString(input.tokenName, "authorization.tokenName", 1, 128),
    tokenVersion: boundedString(input.tokenVersion, "authorization.tokenVersion", 1, 32),
    digest: hash(input.digest, "authorization.digest")
  };
}

function buildStoredCheck(input: {
  input: CreateCheckInput;
  operatorPublicKey: string;
  request: ReturnType<typeof normalizeOriginalRequest>;
  terms: PaymentTerms;
  authorization: AuthorizationIntent | null;
  evidence: PaymentAssetEvidence;
  policy: StoredPaymentCheck["policy"];
  providerDecision: ProviderDecision | null;
  decision: PaymentDecision;
  now: string;
}): StoredPaymentCheck {
  return {
    id: input.decision.checkId,
    operatorPublicKey: input.operatorPublicKey,
    agentTokenId: input.input.agentTokenId,
    payerPublicKey: input.authorization?.payerPublicKey ?? null,
    idempotencyKey: input.input.idempotencyKey,
    request: input.request,
    terms: input.terms,
    authorization: input.authorization,
    evidence: input.evidence,
    policy: input.policy,
    providerDecision: input.providerDecision,
    decision: input.decision,
    status: input.decision.verdict === "pay" ? "reserved" : input.decision.verdict === "block" ? "blocked" : "review",
    createdAt: input.now,
    updatedAt: input.now
  };
}

function selectProviderDecision(
  decisions: ProviderDecision[],
  origin: string,
  path: string,
  terms: PaymentTerms
): ProviderDecision | null {
  return decisions.find(
    (decision) =>
      decision.origin === origin &&
      decision.payee === terms.payTo &&
      decision.asset === terms.asset &&
      decision.network === terms.network &&
      (decision.resourcePathPrefix === null || path.startsWith(decision.resourcePathPrefix))
  ) ?? null;
}

function ensureIdempotentMatch(
  existing: StoredPaymentCheck,
  agentTokenId: string | null,
  terms: PaymentTerms,
  requestHash: string,
  authorization: AuthorizationIntent | null
): void {
  const matches =
    existing.agentTokenId === agentTokenId &&
    existing.request.requestHash === requestHash &&
    existing.terms.requirementHash === terms.requirementHash &&
    artifactHash(existing.authorization) === artifactHash(authorization);
  if (!matches) {
    throw new AuthError("idempotency_conflict", "Idempotency key was already used for different payment content", 409, {
      field: "Idempotency-Key",
      expected: existing.idempotencyKey,
      received: "different request, terms, authorization, or agent"
    });
  }
}

function blockReservationFailure(decision: PaymentDecision, reservation: Exclude<ReservationResult, { ok: true }>): PaymentDecision {
  const reason = reservationFailureReason(reservation.reason);
  const reasons = decision.reasons.some((candidate) => candidate.code === reason.code)
    ? decision.reasons
    : [...decision.reasons, reason];
  const content = {
    checkId: decision.checkId,
    verdict: "block" as const,
    basis: null,
    reasons,
    advisories: decision.advisories,
    policyHash: decision.policyHash,
    authorizationDigest: decision.authorizationDigest,
    reservation: null,
    decidedAt: decision.decidedAt
  };
  return { ...content, decisionHash: artifactHash(content) };
}

function reservationFailureReason(reason: Exclude<ReservationResult, { ok: true }>["reason"]): Reason {
  const reservationMismatch = ["reservation_conflict", "check_not_found", "check_conflict"].includes(reason);
  const code: ReasonCode = reason === "authorization_replay"
    ? "authorization_replay"
    : reservationMismatch
      ? "authorization_field_mismatch"
      : "policy_daily_cap_exceeded";
  return {
    code,
    result: "block",
    message:
      reason === "authorization_replay"
        ? "Authorization nonce was reserved by another payment"
        : reason === "maximum_concurrent_reservations"
          ? "Maximum concurrent payment reservations was reached"
          : reason === "policy_daily_cap_exceeded"
            ? "Payment lost atomic admission under the signed daily cap"
            : "Payment reservation no longer matches the approved check",
    field: reason === "authorization_replay" ? "authorization.nonce" : "reservation",
    expected: "atomic reservation admission",
    received: reason
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalidRequest(field, "string", value);
  return value;
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number") throw invalidRequest(field, "number", value);
  return value;
}

function boundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw invalidRequest(field, `${minimum}..${maximum} characters`, value);
  }
  return value;
}

function parsePublicKey(value: unknown, field: string): string {
  try {
    return parseCasperPublicKey(stringField(value, field)).publicKeyHex;
  } catch {
    throw invalidRequest(field, "tagged Casper public key", value);
  }
}

function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw invalidRequest(field, "tagged Casper address", value);
  return value;
}

function decimal(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || (!allowZero && value === "0")) {
    throw invalidRequest(field, allowZero ? "non-negative decimal string" : "positive decimal string", value);
  }
  return value;
}

function safeTimestampInteger(value: unknown, field: string): string {
  const parsed = decimal(value, field, true);
  if (!Number.isSafeInteger(Number(parsed))) throw invalidRequest(field, "safe integer timestamp", value);
  return parsed;
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !HEX_64.test(value)) throw invalidRequest(field, "64 lowercase hexadecimal characters", value);
  return value;
}

function parseHash(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalidRequest(field, "64 lowercase hexadecimal characters", value);
  return hash(value, field);
}

function network(value: unknown, field: string): "casper:casper-test" {
  if (value !== "casper:casper-test") throw invalidRequest(field, "casper:casper-test", value);
  return value;
}

function invalidRequest(field: string, expected: unknown, received: unknown): AuthError {
  return new AuthError("invalid_request", `${field} is invalid`, 400, { field, expected, received });
}

function settlementCheckStatus(proof: SettlementProof): StoredPaymentCheck["status"] {
  switch (proof.verdict) {
    case "match": return "settled";
    case "mismatch": return "settlement_mismatch";
    case "pending": return "settlement_pending";
    case "unverifiable": return "settlement_unverifiable";
  }
}

function parseResponseObservation(checkId: string, value: unknown, now: Date): ResponseObservation {
  const input = asRecord(value);
  if (!input) throw invalidRequest("observation", "object", value);
  const allowedKeys = ["bodyBytes", "bodyHash", "contentType", "observedAt", "observerVersion", "status"];
  const receivedKeys = Object.keys(input).sort();
  if (artifactHash(receivedKeys) !== artifactHash(allowedKeys)) {
    throw invalidRequest("observation", allowedKeys, receivedKeys);
  }
  const observerVersion = boundedString(input.observerVersion, "observerVersion", 1, 128);
  const status = numberField(input.status, "status");
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw invalidRequest("status", "HTTP status from 100 to 599", status);
  }
  const contentType = input.contentType === null
    ? null
    : boundedString(input.contentType, "contentType", 1, 256);
  const bodyBytes = numberField(input.bodyBytes, "bodyBytes");
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 0) {
    throw invalidRequest("bodyBytes", "non-negative safe integer", bodyBytes);
  }
  const bodyHash = parseHash(input.bodyHash, "bodyHash");
  const observedAt = canonicalTimestamp(input.observedAt, "observedAt");
  if (Date.parse(observedAt) > now.getTime()) {
    throw invalidRequest("observedAt", "timestamp no later than server time", observedAt);
  }
  const content = { checkId, observerVersion, status, contentType, bodyBytes, bodyHash, observedAt };
  return { ...content, observationHash: artifactHash(content) };
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalidRequest(field, "canonical ISO timestamp", value);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw invalidRequest(field, "canonical ISO timestamp", value);
  }
  return value;
}

function settlementConflict(expected: string | null, received: string): AuthError {
  return new AuthError("settlement_conflict", "Payment check is already bound to another settlement", 409, {
    field: "transactionHash",
    expected,
    received
  });
}

function observationConflict(expected: string | null, received: string): AuthError {
  return new AuthError("observation_conflict", "Payment response metadata is already recorded", 409, {
    field: "observation",
    expected,
    received
  });
}
