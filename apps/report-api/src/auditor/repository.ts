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

export type AuthChallenge = {
  id: string;
  operatorPublicKey: string;
  origin: string;
  purpose: "session" | "operator_action";
  nonce: string;
  action: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
};

export type AuthSession = {
  id: string;
  operatorPublicKey: string;
  tokenHash: string;
  origin: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type AgentTokenScope =
  | "checks:write"
  | "settlements:write"
  | "observations:write"
  | "receipts:read";

export type AgentTokenRecord = {
  id: string;
  operatorPublicKey: string;
  agentName: string;
  tokenHash: string;
  scopes: AgentTokenScope[];
  allowedPayerPublicKeys: string[];
  revision: number;
  actionHash: string;
  signature: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type AgentTokenRevocation = {
  tokenId: string;
  operatorPublicKey: string;
  revision: number;
  actionHash: string;
  signature: string;
  revokedAt: string;
};

export type CheckStatus =
  | "review"
  | "blocked"
  | "reserved"
  | "cancelled"
  | "settlement_pending"
  | "settled"
  | "settlement_mismatch"
  | "settlement_unverifiable";

export type StoredPaymentCheck = {
  id: string;
  operatorPublicKey: string;
  agentTokenId: string | null;
  payerPublicKey: string | null;
  idempotencyKey: string | null;
  request: OriginalRequest;
  terms: PaymentTerms;
  authorization: AuthorizationIntent | null;
  evidence: PaymentAssetEvidence;
  policy: OperatorPolicy | null;
  providerDecision: ProviderDecision | null;
  decision: PaymentDecision;
  status: CheckStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReservationStatus = "active" | "consumed" | "released" | "quarantined" | "expired";

export type ReservationRecord = {
  checkId: string;
  operatorPublicKey: string;
  asset: string;
  amount: string;
  utcDay: string;
  status: ReservationStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ReservationInput = {
  checkId: string;
  operatorPublicKey: string;
  asset: string;
  amount: string;
  dailyCap: string;
  maximumConcurrentReservations: number;
  payerPublicKey: string;
  nonce: string;
  expiresAt: string;
};

export type ReservationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "check_not_found"
        | "check_conflict"
        | "reservation_conflict"
        | "authorization_replay"
        | "policy_daily_cap_exceeded"
        | "maximum_concurrent_reservations";
    };

export type ResponseObservation = {
  checkId: string;
  observerVersion: string;
  status: number;
  contentType: string | null;
  bodyBytes: number;
  bodyHash: string;
  observedAt: string;
  observationHash: string;
};

export type SettlementApplyResult =
  | { ok: true; created: boolean; settlement: SettlementProof }
  | {
      ok: false;
      reason:
        | "check_not_found"
        | "check_conflict"
        | "transaction_conflict"
        | "reservation_conflict"
        | "terminal_settlement";
    };

export type ObservationReceiptResult =
  | { ok: true; created: boolean }
  | {
      ok: false;
      reason: "check_not_found" | "settlement_required" | "observation_conflict" | "receipt_conflict";
    };

export type ReceiptShareRecord = {
  id: string;
  receiptId: string;
  operatorPublicKey: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type AnchorJobStatus = "pending" | "submitted" | "confirmed" | "failed";

export type AnchorJob = {
  id: string;
  receiptId: string;
  status: AnchorJobStatus;
  attempts: number;
  nextAttemptAt: string;
  transactionHash: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface AuditorRepository {
  schemaVersion(): number;

  saveChallenge(challenge: AuthChallenge): boolean;
  getChallenge(id: string): AuthChallenge | null;
  consumeChallenge(id: string, usedAt: string): boolean;

  saveSession(session: AuthSession): boolean;
  findSessionByTokenHash(tokenHash: string): AuthSession | null;
  revokeSession(id: string, revokedAt: string): boolean;

  savePolicy(policy: OperatorPolicy): boolean;
  getCurrentPolicy(operatorPublicKey: string): OperatorPolicy | null;
  latestPolicyRevision(operatorPublicKey: string): number;

  saveProviderDecision(decision: ProviderDecision): boolean;
  listProviderDecisions(operatorPublicKey: string): ProviderDecision[];
  latestProviderDecisionRevision(operatorPublicKey: string): number;

  saveAgentToken(token: AgentTokenRecord): boolean;
  getAgentToken(id: string): AgentTokenRecord | null;
  findAgentTokenByHash(tokenHash: string): AgentTokenRecord | null;
  latestAgentTokenRevision(operatorPublicKey: string): number;
  revokeAgentToken(revocation: AgentTokenRevocation): boolean;
  getAgentTokenRevocation(tokenId: string): AgentTokenRevocation | null;

  saveCheck(check: StoredPaymentCheck): boolean;
  updateCheck(check: StoredPaymentCheck): boolean;
  getCheck(id: string): StoredPaymentCheck | null;
  findCheckByIdempotencyKey(operatorPublicKey: string, idempotencyKey: string): StoredPaymentCheck | null;

  reserve(input: ReservationInput): ReservationResult;
  saveCheckAndReserve(check: StoredPaymentCheck, input: ReservationInput): ReservationResult;
  getReservation(checkId: string): ReservationRecord | null;
  transitionReservation(checkId: string, status: Exclude<ReservationStatus, "active" | "expired">, at: string): boolean;
  reservedTotal(operatorPublicKey: string, asset: string, utcDay: string): string;
  spentTotal(operatorPublicKey: string, asset: string, utcDay: string): string;
  activeReservationCount(operatorPublicKey: string): number;
  authorizationReplayUsed(operatorPublicKey: string, asset: string, payerPublicKey: string, nonce: string): boolean;

  saveSettlement(settlement: SettlementProof): boolean;
  getSettlement(checkId: string): SettlementProof | null;
  applySettlement(
    check: StoredPaymentCheck,
    settlement: SettlementProof,
    reservationStatus: "consumed" | "quarantined" | null
  ): SettlementApplyResult;
  saveResponseObservation(observation: ResponseObservation): boolean;
  getResponseObservation(checkId: string): ResponseObservation | null;
  saveObservationAndReceipt(
    observation: ResponseObservation,
    receipt: PurchaseReceipt,
    anchorJob?: AnchorJob
  ): ObservationReceiptResult;

  saveReceipt(receipt: PurchaseReceipt): boolean;
  getReceipt(receiptId: string): PurchaseReceipt | null;
  getReceiptByCheckId(checkId: string): PurchaseReceipt | null;
  saveReceiptShare(share: ReceiptShareRecord): boolean;
  getReceiptShare(id: string): ReceiptShareRecord | null;
  findReceiptShareByTokenHash(receiptId: string, tokenHash: string): ReceiptShareRecord | null;
  revokeReceiptShare(id: string, operatorPublicKey: string, revokedAt: string): boolean;

  saveAnchorJob(job: AnchorJob): boolean;
  updateAnchorJob(job: AnchorJob): boolean;
  getAnchorJob(id: string): AnchorJob | null;
  listDueAnchorJobs(now: string, limit: number): AnchorJob[];
}
