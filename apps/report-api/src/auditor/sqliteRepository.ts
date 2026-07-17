import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { canonicalJson, type OperatorPolicy, type ProviderDecision, type PurchaseReceipt, type SettlementProof } from "@agent-pay/core";
import type {
  AgentTokenRecord,
  AgentTokenRevocation,
  AnchorJob,
  AuditorRepository,
  AuthChallenge,
  AuthSession,
  ReservationInput,
  ReservationRecord,
  ReservationResult,
  ReservationStatus,
  ObservationReceiptResult,
  ReceiptShareRecord,
  ResponseObservation,
  SettlementApplyResult,
  StoredPaymentCheck
} from "./repository.js";

const CURRENT_SCHEMA_VERSION = 6;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const UTC_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export type OpenSqliteRepositoryOptions = {
  now?: () => Date;
};

export interface SqliteAuditorRepository extends AuditorRepository {
  close(): void;
}

export function openSqliteRepository(
  path: string,
  options: OpenSqliteRepositoryOptions = {}
): SqliteAuditorRepository {
  if (!path) throw new TypeError("SQLite database path must not be empty");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new SqliteRepository(path, options.now ?? (() => new Date()));
}

class SqliteRepository implements SqliteAuditorRepository {
  private readonly database: DatabaseSync;
  private readonly now: () => Date;
  private closed = false;

  constructor(path: string, now: () => Date) {
    this.database = new DatabaseSync(path);
    this.now = now;
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  schemaVersion(): number {
    const row = this.row("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations");
    return numberColumn(row, "version");
  }

  saveChallenge(challenge: AuthChallenge): boolean {
    const now = isoTimestamp(this.now().toISOString(), "repository.now");
    this.database.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(now);
    return this.insert(
      `INSERT OR IGNORE INTO auth_challenges
        (id, operator_key, origin, purpose, nonce, issued_at, expires_at, used_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      challenge.id,
      normalizeKey(challenge.operatorPublicKey),
      challenge.origin,
      challenge.purpose,
      challenge.nonce,
      isoTimestamp(challenge.issuedAt, "challenge.issuedAt"),
      isoTimestamp(challenge.expiresAt, "challenge.expiresAt"),
      nullableTimestamp(challenge.usedAt, "challenge.usedAt"),
      canonicalJson(challenge)
    );
  }

  getChallenge(id: string): AuthChallenge | null {
    const row = this.maybeRow("SELECT json, used_at FROM auth_challenges WHERE id = ?", id);
    if (!row) return null;
    return { ...jsonColumn<AuthChallenge>(row), usedAt: nullableStringColumn(row, "used_at") };
  }

  consumeChallenge(id: string, usedAt: string): boolean {
    const normalized = isoTimestamp(usedAt, "challenge.usedAt");
    return this.changed(
      `UPDATE auth_challenges
       SET used_at = ?
       WHERE id = ? AND used_at IS NULL AND issued_at <= ? AND expires_at > ?`,
      normalized,
      id,
      normalized,
      normalized
    );
  }

  saveSession(session: AuthSession): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO auth_sessions
        (id, operator_key, token_hash, origin, created_at, expires_at, revoked_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      normalizeKey(session.operatorPublicKey),
      normalizeHash(session.tokenHash, "session.tokenHash"),
      session.origin,
      isoTimestamp(session.createdAt, "session.createdAt"),
      isoTimestamp(session.expiresAt, "session.expiresAt"),
      nullableTimestamp(session.revokedAt, "session.revokedAt"),
      canonicalJson(session)
    );
  }

  findSessionByTokenHash(tokenHash: string): AuthSession | null {
    const row = this.maybeRow(
      "SELECT json, revoked_at FROM auth_sessions WHERE token_hash = ?",
      normalizeHash(tokenHash, "session.tokenHash")
    );
    if (!row) return null;
    return { ...jsonColumn<AuthSession>(row), revokedAt: nullableStringColumn(row, "revoked_at") };
  }

  revokeSession(id: string, revokedAt: string): boolean {
    return this.changed(
      "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      isoTimestamp(revokedAt, "session.revokedAt"),
      id
    );
  }

  savePolicy(policy: OperatorPolicy): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO policies
        (policy_id, operator_key, revision, policy_hash, effective_at, json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      policy.policyId,
      normalizeKey(policy.operatorPublicKey),
      positiveInteger(policy.revision, "policy.revision"),
      normalizeHash(policy.policyHash, "policy.policyHash"),
      isoTimestamp(policy.effectiveAt, "policy.effectiveAt"),
      canonicalJson(policy)
    );
  }

  getCurrentPolicy(operatorPublicKey: string): OperatorPolicy | null {
    const row = this.maybeRow(
      "SELECT json FROM policies WHERE operator_key = ? ORDER BY revision DESC LIMIT 1",
      normalizeKey(operatorPublicKey)
    );
    return row ? jsonColumn<OperatorPolicy>(row) : null;
  }

  latestPolicyRevision(operatorPublicKey: string): number {
    const row = this.row(
      "SELECT COALESCE(MAX(revision), 0) AS revision FROM policies WHERE operator_key = ?",
      normalizeKey(operatorPublicKey)
    );
    return numberColumn(row, "revision");
  }

  saveProviderDecision(decision: ProviderDecision): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO provider_decisions
        (decision_id, operator_key, revision, kind, origin, payee, asset, network, expires_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      decision.decisionId,
      normalizeKey(decision.operatorPublicKey),
      positiveInteger(decision.revision, "providerDecision.revision"),
      decision.kind,
      decision.origin,
      normalizeKey(decision.payee),
      normalizeKey(decision.asset),
      decision.network,
      isoTimestamp(decision.expiresAt, "providerDecision.expiresAt"),
      canonicalJson(decision)
    );
  }

  listProviderDecisions(operatorPublicKey: string): ProviderDecision[] {
    return this.rows(
      "SELECT json FROM provider_decisions WHERE operator_key = ? ORDER BY revision DESC",
      normalizeKey(operatorPublicKey)
    ).map((row) => jsonColumn<ProviderDecision>(row));
  }

  latestProviderDecisionRevision(operatorPublicKey: string): number {
    const row = this.row(
      "SELECT COALESCE(MAX(revision), 0) AS revision FROM provider_decisions WHERE operator_key = ?",
      normalizeKey(operatorPublicKey)
    );
    return numberColumn(row, "revision");
  }

  saveAgentToken(token: AgentTokenRecord): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO agent_tokens
        (id, operator_key, token_hash, revision, expires_at, revoked_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      token.id,
      normalizeKey(token.operatorPublicKey),
      normalizeHash(token.tokenHash, "agentToken.tokenHash"),
      positiveInteger(token.revision, "agentToken.revision"),
      nullableTimestamp(token.expiresAt, "agentToken.expiresAt"),
      nullableTimestamp(token.revokedAt, "agentToken.revokedAt"),
      canonicalJson(token)
    );
  }

  getAgentToken(id: string): AgentTokenRecord | null {
    const row = this.maybeRow("SELECT json, revoked_at FROM agent_tokens WHERE id = ?", id);
    return row ? tokenFromRow(row) : null;
  }

  listAgentTokens(operatorPublicKey: string): AgentTokenRecord[] {
    return this.rows(
      "SELECT json, revoked_at FROM agent_tokens WHERE operator_key = ? ORDER BY revision DESC",
      normalizeKey(operatorPublicKey)
    ).map(tokenFromRow);
  }

  findAgentTokenByHash(tokenHash: string): AgentTokenRecord | null {
    const row = this.maybeRow(
      "SELECT json, revoked_at FROM agent_tokens WHERE token_hash = ?",
      normalizeHash(tokenHash, "agentToken.tokenHash")
    );
    return row ? tokenFromRow(row) : null;
  }

  latestAgentTokenRevision(operatorPublicKey: string): number {
    const row = this.row(
      `SELECT COALESCE(MAX(revision), 0) AS revision FROM (
         SELECT revision FROM agent_tokens WHERE operator_key = ?
         UNION ALL
         SELECT revision FROM agent_token_revocations WHERE operator_key = ?
       )`,
      normalizeKey(operatorPublicKey),
      normalizeKey(operatorPublicKey)
    );
    return numberColumn(row, "revision");
  }

  revokeAgentToken(revocation: AgentTokenRevocation): boolean {
    const operatorKey = normalizeKey(revocation.operatorPublicKey);
    const revokedAt = isoTimestamp(revocation.revokedAt, "agentTokenRevocation.revokedAt");
    const revision = positiveInteger(revocation.revision, "agentTokenRevocation.revision");
    const actionHash = normalizeHash(revocation.actionHash, "agentTokenRevocation.actionHash");

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const token = this.maybeRow(
        "SELECT operator_key, revoked_at FROM agent_tokens WHERE id = ?",
        revocation.tokenId
      );
      const expectedRevision = this.latestAgentTokenRevision(operatorKey) + 1;
      if (
        !token ||
        stringColumn(token, "operator_key") !== operatorKey ||
        token.revoked_at !== null ||
        revision !== expectedRevision
      ) {
        this.database.exec("ROLLBACK");
        return false;
      }
      const inserted = this.insert(
        `INSERT OR IGNORE INTO agent_token_revocations
          (token_id, operator_key, revision, action_hash, revoked_at, json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        revocation.tokenId,
        operatorKey,
        revision,
        actionHash,
        revokedAt,
        canonicalJson({ ...revocation, operatorPublicKey: operatorKey, actionHash, revokedAt })
      );
      if (!inserted) {
        this.database.exec("ROLLBACK");
        return false;
      }
      const updated = this.changed(
        "UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        revokedAt,
        revocation.tokenId
      );
      if (!updated) {
        this.database.exec("ROLLBACK");
        return false;
      }
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // SQLite may already have rolled back the transaction.
      }
      throw error;
    }
  }

  getAgentTokenRevocation(tokenId: string): AgentTokenRevocation | null {
    const row = this.maybeRow("SELECT json FROM agent_token_revocations WHERE token_id = ?", tokenId);
    return row ? jsonColumn<AgentTokenRevocation>(row) : null;
  }

  saveCheck(check: StoredPaymentCheck): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO checks
        (id, operator_key, agent_token_id, payer_key, idempotency_key, verdict, status, created_at, updated_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      check.id,
      normalizeKey(check.operatorPublicKey),
      check.agentTokenId,
      check.payerPublicKey ? normalizeKey(check.payerPublicKey) : null,
      check.idempotencyKey,
      check.decision.verdict,
      check.status,
      isoTimestamp(check.createdAt, "check.createdAt"),
      isoTimestamp(check.updatedAt, "check.updatedAt"),
      canonicalJson(check)
    );
  }

  updateCheck(check: StoredPaymentCheck): boolean {
    return this.changed(
      `UPDATE checks
       SET verdict = ?, status = ?, updated_at = ?, json = ?
       WHERE id = ? AND operator_key = ? AND created_at = ?
         AND ((idempotency_key IS NULL AND ? IS NULL) OR idempotency_key = ?)`,
      check.decision.verdict,
      check.status,
      isoTimestamp(check.updatedAt, "check.updatedAt"),
      canonicalJson(check),
      check.id,
      normalizeKey(check.operatorPublicKey),
      isoTimestamp(check.createdAt, "check.createdAt"),
      check.idempotencyKey,
      check.idempotencyKey
    );
  }

  getCheck(id: string): StoredPaymentCheck | null {
    const row = this.maybeRow("SELECT json FROM checks WHERE id = ?", id);
    return row ? jsonColumn<StoredPaymentCheck>(row) : null;
  }

  findCheckByIdempotencyKey(operatorPublicKey: string, idempotencyKey: string): StoredPaymentCheck | null {
    const row = this.maybeRow(
      "SELECT json FROM checks WHERE operator_key = ? AND idempotency_key = ?",
      normalizeKey(operatorPublicKey),
      idempotencyKey
    );
    return row ? jsonColumn<StoredPaymentCheck>(row) : null;
  }

  reserve(input: ReservationInput): ReservationResult {
    const prepared = prepareReservation(input, this.nowIso());
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.reserveWithinTransaction(input, prepared);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.rollbackQuietly();
      throw error;
    }
  }

  saveCheckAndReserve(check: StoredPaymentCheck, input: ReservationInput): ReservationResult {
    if (check.id !== input.checkId) {
      throw new TypeError("Reserved check id must match reservation.checkId");
    }
    const prepared = prepareReservation(input, this.nowIso());
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (!this.saveCheck(check)) {
        this.database.exec("ROLLBACK");
        return { ok: false, reason: "check_conflict" };
      }
      const result = this.reserveWithinTransaction(input, prepared);
      if (!result.ok) {
        this.database.exec("ROLLBACK");
        return result;
      }
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.rollbackQuietly();
      throw error;
    }
  }

  getReservation(checkId: string): ReservationRecord | null {
    const row = this.maybeRow("SELECT * FROM reservations WHERE check_id = ?", checkId);
    return row ? reservationFromRow(row) : null;
  }

  transitionReservation(
    checkId: string,
    status: Exclude<ReservationStatus, "active" | "expired">,
    at: string
  ): boolean {
    const allowedFrom = status === "quarantined" ? ["active"] : ["active", "quarantined"];
    const placeholders = allowedFrom.map(() => "?").join(", ");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.changed(
        `UPDATE reservations SET status = ?, updated_at = ?
         WHERE check_id = ? AND status IN (${placeholders})`,
        status,
        isoTimestamp(at, "reservation.updatedAt"),
        checkId,
        ...allowedFrom
      );
      if (changed && status === "released") {
        this.database.prepare("DELETE FROM authorization_reservations WHERE check_id = ?").run(checkId);
      }
      this.database.exec("COMMIT");
      return changed;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // SQLite may already have rolled back the transaction.
      }
      throw error;
    }
  }

  reservedTotal(operatorPublicKey: string, asset: string, utcDay: string): string {
    validateUtcDay(utcDay);
    this.expireReservations(this.nowIso());
    return this.sumReservationRows(
      normalizeKey(operatorPublicKey),
      normalizeKey(asset),
      utcDay,
      ["active", "quarantined"]
    ).toString();
  }

  spentTotal(operatorPublicKey: string, asset: string, utcDay: string): string {
    validateUtcDay(utcDay);
    return this.sumReservationRows(
      normalizeKey(operatorPublicKey),
      normalizeKey(asset),
      utcDay,
      ["consumed"]
    ).toString();
  }

  activeReservationCount(operatorPublicKey: string): number {
    this.expireReservations(this.nowIso());
    return numberColumn(
      this.row(
        `SELECT COUNT(*) AS count FROM reservations
         WHERE operator_key = ? AND status IN ('active', 'quarantined')`,
        normalizeKey(operatorPublicKey)
      ),
      "count"
    );
  }

  authorizationReplayUsed(
    operatorPublicKey: string,
    asset: string,
    payerPublicKey: string,
    nonce: string
  ): boolean {
    this.expireReservations(this.nowIso());
    return this.maybeRow(
      `SELECT 1 AS found FROM authorization_reservations replay
       JOIN reservations reservation ON reservation.check_id = replay.check_id
       WHERE replay.operator_key = ? AND replay.asset = ? AND replay.payer_key = ? AND replay.nonce = ?
         AND reservation.status IN ('active', 'quarantined', 'consumed')
       LIMIT 1`,
      normalizeKey(operatorPublicKey),
      normalizeKey(asset),
      normalizeKey(payerPublicKey),
      normalizeHash(nonce, "authorization.nonce")
    ) !== null;
  }

  saveSettlement(settlement: SettlementProof): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO settlements
        (check_id, transaction_hash, verdict, observed_at, json)
       VALUES (?, ?, ?, ?, ?)`,
      settlement.checkId,
      normalizeHash(settlement.transactionHash, "settlement.transactionHash"),
      settlement.verdict,
      isoTimestamp(settlement.observedAt, "settlement.observedAt"),
      canonicalJson(settlement)
    );
  }

  getSettlement(checkId: string): SettlementProof | null {
    const row = this.maybeRow("SELECT json FROM settlements WHERE check_id = ?", checkId);
    return row ? jsonColumn<SettlementProof>(row) : null;
  }

  applySettlement(
    check: StoredPaymentCheck,
    settlement: SettlementProof,
    reservationStatus: "consumed" | "quarantined" | null
  ): SettlementApplyResult {
    if (check.id !== settlement.checkId) {
      throw new TypeError("Settlement check id must match the updated check");
    }
    const transactionHash = normalizeHash(settlement.transactionHash, "settlement.transactionHash");
    const observedAt = isoTimestamp(settlement.observedAt, "settlement.observedAt");
    const proofHash = normalizeHash(settlement.proofHash, "settlement.proofHash");

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const checkRow = this.maybeRow("SELECT operator_key, created_at, json FROM checks WHERE id = ?", check.id);
      if (!checkRow) return this.rollbackResult({ ok: false, reason: "check_not_found" });
      const storedCheck = jsonColumn<StoredPaymentCheck>(checkRow);
      if (
        stringColumn(checkRow, "operator_key") !== normalizeKey(check.operatorPublicKey) ||
        stringColumn(checkRow, "created_at") !== isoTimestamp(check.createdAt, "check.createdAt") ||
        storedCheck.idempotencyKey !== check.idempotencyKey
      ) {
        return this.rollbackResult({ ok: false, reason: "check_conflict" });
      }

      const existingRow = this.maybeRow("SELECT json FROM settlements WHERE check_id = ?", check.id);
      const existing = existingRow ? jsonColumn<SettlementProof>(existingRow) : null;
      if (existing && existing.transactionHash !== transactionHash) {
        return this.rollbackResult({ ok: false, reason: "transaction_conflict" });
      }
      if (existing && (existing.verdict === "match" || existing.verdict === "mismatch")) {
        this.database.exec("ROLLBACK");
        return { ok: true, created: false, settlement: existing };
      }
      if (!["reserved", "settlement_pending", "settlement_unverifiable"].includes(storedCheck.status)) {
        return this.rollbackResult({ ok: false, reason: "terminal_settlement" });
      }

      const reservation = this.maybeRow("SELECT status FROM reservations WHERE check_id = ?", check.id);
      if (!reservation) return this.rollbackResult({ ok: false, reason: "reservation_conflict" });
      const currentReservationStatus = stringColumn(reservation, "status") as ReservationStatus;
      if (reservationStatus !== null) {
        const allowed = reservationStatus === "consumed"
          ? ["active", "quarantined", "expired"]
          : ["active", "expired"];
        if (currentReservationStatus !== reservationStatus && !allowed.includes(currentReservationStatus)) {
          return this.rollbackResult({ ok: false, reason: "reservation_conflict" });
        }
        if (currentReservationStatus !== reservationStatus) {
          this.database.prepare(
            "UPDATE reservations SET status = ?, updated_at = ? WHERE check_id = ?"
          ).run(reservationStatus, observedAt, check.id);
        }
      } else if (!["active", "expired"].includes(currentReservationStatus)) {
        return this.rollbackResult({ ok: false, reason: "reservation_conflict" });
      }

      const conflictingTransaction = this.maybeRow(
        "SELECT check_id FROM settlements WHERE transaction_hash = ? AND check_id <> ?",
        transactionHash,
        check.id
      );
      if (conflictingTransaction) {
        return this.rollbackResult({ ok: false, reason: "transaction_conflict" });
      }

      this.database.prepare(
        `INSERT OR IGNORE INTO settlement_attempts
          (check_id, transaction_hash, proof_hash, verdict, observed_at, json)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        check.id,
        transactionHash,
        proofHash,
        settlement.verdict,
        observedAt,
        canonicalJson(settlement)
      );
      if (existing) {
        this.database.prepare(
          `UPDATE settlements
           SET verdict = ?, observed_at = ?, json = ?
           WHERE check_id = ? AND transaction_hash = ?`
        ).run(settlement.verdict, observedAt, canonicalJson(settlement), check.id, transactionHash);
      } else {
        this.database.prepare(
          `INSERT INTO settlements
            (check_id, transaction_hash, verdict, observed_at, json)
           VALUES (?, ?, ?, ?, ?)`
        ).run(check.id, transactionHash, settlement.verdict, observedAt, canonicalJson(settlement));
      }
      const updated = this.changed(
        `UPDATE checks
         SET verdict = ?, status = ?, updated_at = ?, json = ?
         WHERE id = ? AND operator_key = ? AND created_at = ?`,
        check.decision.verdict,
        check.status,
        isoTimestamp(check.updatedAt, "check.updatedAt"),
        canonicalJson(check),
        check.id,
        normalizeKey(check.operatorPublicKey),
        isoTimestamp(check.createdAt, "check.createdAt")
      );
      if (!updated) return this.rollbackResult({ ok: false, reason: "check_conflict" });

      this.database.exec("COMMIT");
      return { ok: true, created: !existing || existing.proofHash !== proofHash, settlement };
    } catch (error) {
      this.rollbackQuietly();
      throw error;
    }
  }

  saveResponseObservation(observation: ResponseObservation): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO response_observations
        (check_id, observation_hash, observed_at, json)
       VALUES (?, ?, ?, ?)`,
      observation.checkId,
      normalizeHash(observation.observationHash, "observation.observationHash"),
      isoTimestamp(observation.observedAt, "observation.observedAt"),
      canonicalJson(observation)
    );
  }

  getResponseObservation(checkId: string): ResponseObservation | null {
    const row = this.maybeRow("SELECT json FROM response_observations WHERE check_id = ?", checkId);
    return row ? jsonColumn<ResponseObservation>(row) : null;
  }

  saveObservationAndReceipt(
    observation: ResponseObservation,
    receipt: PurchaseReceipt,
    anchorJob?: AnchorJob
  ): ObservationReceiptResult {
    if (observation.checkId !== receipt.checkId) {
      throw new TypeError("Observation and receipt check ids must match");
    }
    if (anchorJob && anchorJob.receiptId !== receipt.receiptId) {
      throw new TypeError("Anchor job and receipt ids must match");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (!this.maybeRow("SELECT 1 AS found FROM checks WHERE id = ?", observation.checkId)) {
        return this.rollbackResult({ ok: false, reason: "check_not_found" });
      }
      const settlementRow = this.maybeRow("SELECT verdict FROM settlements WHERE check_id = ?", observation.checkId);
      if (!settlementRow || stringColumn(settlementRow, "verdict") !== "match") {
        return this.rollbackResult({ ok: false, reason: "settlement_required" });
      }

      const existingObservation = this.getResponseObservation(observation.checkId);
      if (existingObservation && existingObservation.observationHash !== observation.observationHash) {
        return this.rollbackResult({ ok: false, reason: "observation_conflict" });
      }
      const existingReceipt = this.getReceiptByCheckId(receipt.checkId);
      if (!existingObservation && existingReceipt && existingReceipt.receiptHash !== receipt.receiptHash) {
        return this.rollbackResult({ ok: false, reason: "receipt_conflict" });
      }

      if (!existingObservation) {
        this.database.prepare(
          `INSERT INTO response_observations
            (check_id, observation_hash, observed_at, json)
           VALUES (?, ?, ?, ?)`
        ).run(
          observation.checkId,
          normalizeHash(observation.observationHash, "observation.observationHash"),
          isoTimestamp(observation.observedAt, "observation.observedAt"),
          canonicalJson(observation)
        );
      }
      if (!existingReceipt) {
        this.database.prepare(
          `INSERT INTO receipts
            (receipt_id, check_id, receipt_hash, created_at, json)
           VALUES (?, ?, ?, ?, ?)`
        ).run(
          receipt.receiptId,
          receipt.checkId,
          normalizeHash(receipt.receiptHash, "receipt.receiptHash"),
          isoTimestamp(receipt.createdAt, "receipt.createdAt"),
          canonicalJson(receipt)
        );
      }
      if (anchorJob && !this.getAnchorJob(anchorJob.id)) {
        this.database.prepare(
          `INSERT INTO anchor_jobs
            (id, receipt_id, status, attempts, next_attempt_at, transaction_hash, updated_at, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          anchorJob.id,
          anchorJob.receiptId,
          anchorJob.status,
          nonNegativeInteger(anchorJob.attempts, "anchorJob.attempts"),
          isoTimestamp(anchorJob.nextAttemptAt, "anchorJob.nextAttemptAt"),
          nullableHash(anchorJob.transactionHash, "anchorJob.transactionHash"),
          isoTimestamp(anchorJob.updatedAt, "anchorJob.updatedAt"),
          canonicalJson(anchorJob)
        );
      }

      this.database.exec("COMMIT");
      return { ok: true, created: !existingObservation && !existingReceipt };
    } catch (error) {
      this.rollbackQuietly();
      throw error;
    }
  }

  saveReceipt(receipt: PurchaseReceipt): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO receipts
        (receipt_id, check_id, receipt_hash, created_at, json)
       VALUES (?, ?, ?, ?, ?)`,
      receipt.receiptId,
      receipt.checkId,
      normalizeHash(receipt.receiptHash, "receipt.receiptHash"),
      isoTimestamp(receipt.createdAt, "receipt.createdAt"),
      canonicalJson(receipt)
    );
  }

  getReceipt(receiptId: string): PurchaseReceipt | null {
    const row = this.maybeRow("SELECT json FROM receipts WHERE receipt_id = ?", receiptId);
    return row ? jsonColumn<PurchaseReceipt>(row) : null;
  }

  getReceiptByCheckId(checkId: string): PurchaseReceipt | null {
    const row = this.maybeRow("SELECT json FROM receipts WHERE check_id = ?", checkId);
    return row ? jsonColumn<PurchaseReceipt>(row) : null;
  }

  saveReceiptShare(share: ReceiptShareRecord): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO receipt_shares
        (id, receipt_id, operator_key, token_hash, created_at, expires_at, revoked_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      share.id,
      share.receiptId,
      normalizeKey(share.operatorPublicKey),
      normalizeHash(share.tokenHash, "receiptShare.tokenHash"),
      isoTimestamp(share.createdAt, "receiptShare.createdAt"),
      isoTimestamp(share.expiresAt, "receiptShare.expiresAt"),
      nullableTimestamp(share.revokedAt, "receiptShare.revokedAt"),
      canonicalJson(share)
    );
  }

  getReceiptShare(id: string): ReceiptShareRecord | null {
    const row = this.maybeRow("SELECT json, revoked_at FROM receipt_shares WHERE id = ?", id);
    return row ? receiptShareFromRow(row) : null;
  }

  findReceiptShareByTokenHash(receiptId: string, tokenHash: string): ReceiptShareRecord | null {
    const row = this.maybeRow(
      "SELECT json, revoked_at FROM receipt_shares WHERE receipt_id = ? AND token_hash = ?",
      receiptId,
      normalizeHash(tokenHash, "receiptShare.tokenHash")
    );
    return row ? receiptShareFromRow(row) : null;
  }

  revokeReceiptShare(id: string, operatorPublicKey: string, revokedAt: string): boolean {
    return this.changed(
      `UPDATE receipt_shares
       SET revoked_at = ?
       WHERE id = ? AND operator_key = ? AND revoked_at IS NULL`,
      isoTimestamp(revokedAt, "receiptShare.revokedAt"),
      id,
      normalizeKey(operatorPublicKey)
    );
  }

  saveAnchorJob(job: AnchorJob): boolean {
    return this.insert(
      `INSERT OR IGNORE INTO anchor_jobs
        (id, receipt_id, status, attempts, next_attempt_at, transaction_hash, updated_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      job.id,
      job.receiptId,
      job.status,
      nonNegativeInteger(job.attempts, "anchorJob.attempts"),
      isoTimestamp(job.nextAttemptAt, "anchorJob.nextAttemptAt"),
      nullableHash(job.transactionHash, "anchorJob.transactionHash"),
      isoTimestamp(job.updatedAt, "anchorJob.updatedAt"),
      canonicalJson(job)
    );
  }

  updateAnchorJob(job: AnchorJob): boolean {
    return this.changed(
      `UPDATE anchor_jobs
       SET status = ?, attempts = ?, next_attempt_at = ?, transaction_hash = ?, updated_at = ?, json = ?
       WHERE id = ? AND receipt_id = ?`,
      job.status,
      nonNegativeInteger(job.attempts, "anchorJob.attempts"),
      isoTimestamp(job.nextAttemptAt, "anchorJob.nextAttemptAt"),
      nullableHash(job.transactionHash, "anchorJob.transactionHash"),
      isoTimestamp(job.updatedAt, "anchorJob.updatedAt"),
      canonicalJson(job),
      job.id,
      job.receiptId
    );
  }

  getAnchorJob(id: string): AnchorJob | null {
    const row = this.maybeRow("SELECT json FROM anchor_jobs WHERE id = ?", id);
    return row ? jsonColumn<AnchorJob>(row) : null;
  }

  listDueAnchorJobs(now: string, limit: number): AnchorJob[] {
    const timestamp = isoTimestamp(now, "anchorJobs.now");
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new TypeError("anchorJobs.limit must be an integer from 1 to 1000");
    }
    return this.database.prepare(
      `SELECT json FROM anchor_jobs
       WHERE status IN ('pending', 'submitted') AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC, updated_at ASC
       LIMIT ?`
    ).all(timestamp, limit).map((row) => jsonColumn<AnchorJob>(row));
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    const existingVersion = this.schemaVersion();
    if (existingVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Auditor database schema ${existingVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`);
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= existingVersion) continue;
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(migration.sql);
        this.database.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
        ).run(migration.version, this.nowIso());
        this.database.exec("COMMIT");
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // The migration transaction may already have been rolled back.
        }
        throw error;
      }
    }
  }

  private nowIso(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError("SQLite repository clock returned an invalid date");
    }
    return value.toISOString();
  }

  private reserveWithinTransaction(
    input: ReservationInput,
    prepared: PreparedReservation
  ): ReservationResult {
    this.expireReservations(prepared.now);
    const checkRow = this.maybeRow("SELECT operator_key, json FROM checks WHERE id = ?", input.checkId);
    if (!checkRow || stringColumn(checkRow, "operator_key") !== prepared.operatorKey) {
      return { ok: false, reason: "check_not_found" };
    }
    const check = jsonColumn<StoredPaymentCheck>(checkRow);
    if (
      normalizeKey(check.terms.asset) !== prepared.asset ||
      check.terms.amount !== input.amount ||
      !check.authorization ||
      normalizeKey(check.authorization.payerPublicKey) !== prepared.payerKey ||
      check.authorization.nonce !== prepared.nonce
    ) {
      return { ok: false, reason: "reservation_conflict" };
    }

    const existing = this.getReservation(input.checkId);
    if (existing) {
      const identical =
        existing.operatorPublicKey === prepared.operatorKey &&
        existing.asset === prepared.asset &&
        existing.amount === input.amount &&
        existing.status === "active";
      return identical ? { ok: true } : { ok: false, reason: "reservation_conflict" };
    }

    const concurrent = numberColumn(
      this.row(
        `SELECT COUNT(*) AS count FROM reservations
         WHERE operator_key = ? AND status IN ('active', 'quarantined')`,
        prepared.operatorKey
      ),
      "count"
    );
    if (concurrent >= prepared.maximumConcurrent) {
      return { ok: false, reason: "maximum_concurrent_reservations" };
    }

    const replay = this.maybeRow(
      `SELECT 1 AS found FROM authorization_reservations replay
       JOIN reservations reservation ON reservation.check_id = replay.check_id
       WHERE replay.operator_key = ? AND replay.asset = ? AND replay.payer_key = ? AND replay.nonce = ?
         AND reservation.status IN ('active', 'quarantined', 'consumed')
       LIMIT 1`,
      prepared.operatorKey,
      prepared.asset,
      prepared.payerKey,
      prepared.nonce
    );
    if (replay) return { ok: false, reason: "authorization_replay" };

    const committed = this.sumReservationRows(
      prepared.operatorKey,
      prepared.asset,
      prepared.utcDay,
      ["active", "quarantined", "consumed"]
    );
    if (committed + prepared.amount > prepared.dailyCap) {
      return { ok: false, reason: "policy_daily_cap_exceeded" };
    }

    this.database.prepare(
      `INSERT INTO reservations
        (check_id, operator_key, asset, amount, utc_day, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      input.checkId,
      prepared.operatorKey,
      prepared.asset,
      input.amount,
      prepared.utcDay,
      prepared.expiresAt,
      prepared.now,
      prepared.now
    );
    this.database.prepare(
      `INSERT INTO authorization_reservations
        (check_id, operator_key, asset, payer_key, nonce)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.checkId,
      prepared.operatorKey,
      prepared.asset,
      prepared.payerKey,
      prepared.nonce
    );
    return { ok: true };
  }

  private rollbackQuietly(): void {
    try {
      this.database.exec("ROLLBACK");
    } catch {
      // SQLite may already have rolled back the transaction.
    }
  }

  private rollbackResult<T>(result: T): T {
    this.database.exec("ROLLBACK");
    return result;
  }

  private expireReservations(now: string): void {
    this.database.prepare(
      `DELETE FROM authorization_reservations
       WHERE check_id IN (
         SELECT check_id FROM reservations WHERE status = 'active' AND expires_at <= ?
       )`
    ).run(now);
    this.database.prepare(
      `UPDATE reservations SET status = 'expired', updated_at = ?
       WHERE status = 'active' AND expires_at <= ?`
    ).run(now, now);
  }

  private sumReservationRows(
    operatorPublicKey: string,
    asset: string,
    utcDay: string,
    statuses: ReservationStatus[]
  ): bigint {
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.rows(
      `SELECT amount FROM reservations
       WHERE operator_key = ? AND asset = ? AND utc_day = ? AND status IN (${placeholders})`,
      operatorPublicKey,
      asset,
      utcDay,
      ...statuses
    );
    return rows.reduce(
      (total, row) => total + decimalAmount(stringColumn(row, "amount"), "reservation.amount", true),
      0n
    );
  }

  private insert(sql: string, ...values: SQLInputValue[]): boolean {
    return this.changed(sql, ...values);
  }

  private changed(sql: string, ...values: SQLInputValue[]): boolean {
    const result = this.database.prepare(sql).run(...values);
    return Number(result.changes) > 0;
  }

  private row(sql: string, ...values: SQLInputValue[]): Row {
    const result = this.maybeRow(sql, ...values);
    if (!result) throw new Error("SQLite query unexpectedly returned no row");
    return result;
  }

  private maybeRow(sql: string, ...values: SQLInputValue[]): Row | null {
    return (this.database.prepare(sql).get(...values) as Row | undefined) ?? null;
  }

  private rows(sql: string, ...values: SQLInputValue[]): Row[] {
    return this.database.prepare(sql).all(...values) as Row[];
  }
}

type Row = Record<string, unknown>;

type PreparedReservation = {
  amount: bigint;
  dailyCap: bigint;
  maximumConcurrent: number;
  operatorKey: string;
  asset: string;
  payerKey: string;
  nonce: string;
  now: string;
  expiresAt: string;
  utcDay: string;
};

const MIGRATION_1 = `
  CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    operator_key TEXT NOT NULL,
    origin TEXT NOT NULL,
    purpose TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX auth_challenges_operator_idx ON auth_challenges(operator_key, expires_at);

  CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    operator_key TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX auth_sessions_operator_idx ON auth_sessions(operator_key, expires_at);

  CREATE TABLE policies (
    policy_id TEXT PRIMARY KEY,
    operator_key TEXT NOT NULL,
    revision INTEGER NOT NULL,
    policy_hash TEXT NOT NULL UNIQUE,
    effective_at TEXT NOT NULL,
    json TEXT NOT NULL,
    UNIQUE(operator_key, revision)
  ) STRICT;

  CREATE TABLE provider_decisions (
    decision_id TEXT PRIMARY KEY,
    operator_key TEXT NOT NULL,
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL,
    origin TEXT NOT NULL,
    payee TEXT NOT NULL,
    asset TEXT NOT NULL,
    network TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    json TEXT NOT NULL,
    UNIQUE(operator_key, revision)
  ) STRICT;
  CREATE INDEX provider_decisions_tuple_idx
    ON provider_decisions(operator_key, origin, payee, asset, network, revision DESC);

  CREATE TABLE agent_tokens (
    id TEXT PRIMARY KEY,
    operator_key TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    json TEXT NOT NULL,
    UNIQUE(operator_key, revision)
  ) STRICT;

  CREATE TABLE checks (
    id TEXT PRIMARY KEY,
    operator_key TEXT NOT NULL,
    agent_token_id TEXT,
    payer_key TEXT,
    idempotency_key TEXT,
    verdict TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL,
    UNIQUE(operator_key, idempotency_key)
  ) STRICT;
  CREATE INDEX checks_operator_created_idx ON checks(operator_key, created_at DESC);

  CREATE TABLE reservations (
    check_id TEXT PRIMARY KEY REFERENCES checks(id) ON DELETE RESTRICT,
    operator_key TEXT NOT NULL,
    asset TEXT NOT NULL,
    amount TEXT NOT NULL,
    utc_day TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX reservations_cap_idx ON reservations(operator_key, asset, utc_day, status);
  CREATE INDEX reservations_expiry_idx ON reservations(status, expires_at);

  CREATE TABLE settlements (
    check_id TEXT PRIMARY KEY REFERENCES checks(id) ON DELETE RESTRICT,
    transaction_hash TEXT NOT NULL UNIQUE,
    verdict TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE response_observations (
    check_id TEXT PRIMARY KEY REFERENCES checks(id) ON DELETE RESTRICT,
    observation_hash TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE receipts (
    receipt_id TEXT PRIMARY KEY,
    check_id TEXT NOT NULL UNIQUE REFERENCES checks(id) ON DELETE RESTRICT,
    receipt_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE anchor_jobs (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_attempt_at TEXT NOT NULL,
    transaction_hash TEXT,
    updated_at TEXT NOT NULL,
    json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX anchor_jobs_due_idx ON anchor_jobs(status, next_attempt_at);
`;

const MIGRATION_2 = `
  CREATE TABLE agent_token_revocations (
    token_id TEXT PRIMARY KEY REFERENCES agent_tokens(id) ON DELETE RESTRICT,
    operator_key TEXT NOT NULL,
    revision INTEGER NOT NULL,
    action_hash TEXT NOT NULL UNIQUE,
    revoked_at TEXT NOT NULL,
    json TEXT NOT NULL,
    UNIQUE(operator_key, revision)
  ) STRICT;
`;

const MIGRATION_3 = `
  CREATE TABLE authorization_reservations (
    check_id TEXT PRIMARY KEY REFERENCES reservations(check_id) ON DELETE RESTRICT,
    operator_key TEXT NOT NULL,
    asset TEXT NOT NULL,
    payer_key TEXT NOT NULL,
    nonce TEXT NOT NULL,
    UNIQUE(operator_key, asset, payer_key, nonce)
  ) STRICT;
  CREATE INDEX authorization_replay_idx
    ON authorization_reservations(operator_key, asset, payer_key, nonce);
`;

const MIGRATION_4 = `
  CREATE TABLE settlement_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE RESTRICT,
    transaction_hash TEXT NOT NULL,
    proof_hash TEXT NOT NULL UNIQUE,
    verdict TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX settlement_attempts_check_idx
    ON settlement_attempts(check_id, observed_at DESC);
`;

const MIGRATION_5 = `
  CREATE TABLE receipt_shares (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES receipts(receipt_id) ON DELETE RESTRICT,
    operator_key TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX receipt_shares_receipt_idx
    ON receipt_shares(receipt_id, expires_at);
`;

const MIGRATION_6 = `
  ALTER TABLE policies RENAME TO policies_v5;
  CREATE TABLE policies (
    policy_id TEXT NOT NULL,
    operator_key TEXT NOT NULL,
    revision INTEGER NOT NULL,
    policy_hash TEXT NOT NULL UNIQUE,
    effective_at TEXT NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY(policy_id, revision),
    UNIQUE(operator_key, revision)
  ) STRICT;
  INSERT INTO policies
    (policy_id, operator_key, revision, policy_hash, effective_at, json)
  SELECT policy_id, operator_key, revision, policy_hash, effective_at, json
  FROM policies_v5;
  DROP TABLE policies_v5;
`;

const MIGRATIONS = [
  { version: 1, sql: MIGRATION_1 },
  { version: 2, sql: MIGRATION_2 },
  { version: 3, sql: MIGRATION_3 },
  { version: 4, sql: MIGRATION_4 },
  { version: 5, sql: MIGRATION_5 },
  { version: 6, sql: MIGRATION_6 }
] as const;

function tokenFromRow(row: Row): AgentTokenRecord {
  return { ...jsonColumn<AgentTokenRecord>(row), revokedAt: nullableStringColumn(row, "revoked_at") };
}

function receiptShareFromRow(row: Row): ReceiptShareRecord {
  return { ...jsonColumn<ReceiptShareRecord>(row), revokedAt: nullableStringColumn(row, "revoked_at") };
}

function prepareReservation(input: ReservationInput, now: string): PreparedReservation {
  const expiresAt = isoTimestamp(input.expiresAt, "reservation.expiresAt");
  if (expiresAt <= now) throw new TypeError("reservation.expiresAt must be in the future");
  return {
    amount: decimalAmount(input.amount, "reservation.amount", false),
    dailyCap: decimalAmount(input.dailyCap, "reservation.dailyCap", true),
    maximumConcurrent: positiveInteger(
      input.maximumConcurrentReservations,
      "reservation.maximumConcurrentReservations"
    ),
    operatorKey: normalizeKey(input.operatorPublicKey),
    asset: normalizeKey(input.asset),
    payerKey: normalizeKey(input.payerPublicKey),
    nonce: normalizeHash(input.nonce, "reservation.nonce"),
    now,
    expiresAt,
    utcDay: now.slice(0, 10)
  };
}

function reservationFromRow(row: Row): ReservationRecord {
  return {
    checkId: stringColumn(row, "check_id"),
    operatorPublicKey: stringColumn(row, "operator_key"),
    asset: stringColumn(row, "asset"),
    amount: stringColumn(row, "amount"),
    utcDay: stringColumn(row, "utc_day"),
    status: stringColumn(row, "status") as ReservationStatus,
    expiresAt: stringColumn(row, "expires_at"),
    createdAt: stringColumn(row, "created_at"),
    updatedAt: stringColumn(row, "updated_at")
  };
}

function jsonColumn<T>(row: Row): T {
  const value = stringColumn(row, "json");
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error("Stored auditor JSON is invalid", { cause: error });
  }
}

function stringColumn(row: Row, name: string): string {
  const value = row[name];
  if (typeof value !== "string") throw new Error(`SQLite column ${name} is not a string`);
  return value;
}

function nullableStringColumn(row: Row, name: string): string | null {
  const value = row[name];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`SQLite column ${name} is not a string or null`);
  return value;
}

function numberColumn(row: Row, name: string): number {
  const value = row[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`SQLite column ${name} is not a safe integer`);
  }
  return value;
}

function normalizeKey(value: string): string {
  if (typeof value !== "string" || !value) throw new TypeError("Indexed key must not be empty");
  return value.toLowerCase();
}

function normalizeHash(value: string, field: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new TypeError(`${field} must be a 64-character hexadecimal hash`);
  return value.toLowerCase();
}

function nullableHash(value: string | null, field: string): string | null {
  return value === null ? null : normalizeHash(value, field);
}

function isoTimestamp(value: string, field: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be a valid timestamp`);
  return new Date(milliseconds).toISOString();
}

function nullableTimestamp(value: string | null, field: string): string | null {
  return value === null ? null : isoTimestamp(value, field);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function decimalAmount(value: string, field: string, allowZero: boolean): bigint {
  if (!DECIMAL_INTEGER.test(value)) throw new TypeError(`${field} must be a canonical decimal integer string`);
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) throw new TypeError(`${field} must be greater than zero`);
  return parsed;
}

function validateUtcDay(value: string): void {
  if (!UTC_DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new TypeError("utcDay must be a valid YYYY-MM-DD date");
  }
}
