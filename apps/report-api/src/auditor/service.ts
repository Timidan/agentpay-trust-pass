import { randomUUID } from "node:crypto";
import {
  artifactHash,
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
  type Reason,
  type ReasonCode
} from "@agent-pay/core";
import { AuthError } from "./auth.js";
import type {
  AuditorRepository,
  ReservationResult,
  StoredPaymentCheck
} from "./repository.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^(?:(?:00|01)[0-9a-f]{64}|02[0-9a-f]{66})$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

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
  now?: () => Date;
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
  private readonly now: () => Date;

  constructor(options: PaymentAuditServiceOptions) {
    this.repository = options.repository;
    this.evidenceLoader = options.evidenceLoader;
    this.now = options.now ?? (() => new Date());
  }

  async createCheck(input: CreateCheckInput): Promise<{ created: boolean; check: StoredPaymentCheck }> {
    const now = this.nowDate();
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

function network(value: unknown, field: string): "casper:casper-test" {
  if (value !== "casper:casper-test") throw invalidRequest(field, "casper:casper-test", value);
  return value;
}

function invalidRequest(field: string, expected: unknown, received: unknown): AuthError {
  return new AuthError("invalid_request", `${field} is invalid`, 400, { field, expected, received });
}
