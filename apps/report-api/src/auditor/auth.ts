import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  artifactHash,
  operatorActionMessage,
  parseCasperPublicKey,
  verifyCasperMessageSignature
} from "@agent-pay/core";
import type {
  AgentTokenRecord,
  AgentTokenScope,
  AuditorRepository,
  AuthChallenge,
  AuthSession
} from "./repository.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const SESSION_TTL_MS = 60 * 60 * 1_000;
const HASH = /^[0-9a-f]{64}$/i;

export type ApiErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
  field: string | null;
  expected: unknown;
  received: unknown;
};

export type OperatorActionKind =
  | "policy_revision"
  | "provider_decision"
  | "agent_token_issue"
  | "agent_token_revoke";

export type OperatorActionDescriptor = {
  kind: OperatorActionKind;
  artifactHash: string;
  revision: number;
};

export type AgentTokenIssueSpec = {
  operatorPublicKey: string;
  revision: number;
  agentName: string;
  scopes: AgentTokenScope[];
  allowedPayerPublicKeys: string[];
  expiresAt: string | null;
};

export type AuthPrincipal =
  | { kind: "operator"; session: AuthSession }
  | { kind: "agent"; token: AgentTokenRecord };

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly field: string | null;
  readonly expected: unknown;
  readonly received: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details: Partial<Omit<ApiErrorBody, "code" | "message">> = {}
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryable = details.retryable ?? false;
    this.field = details.field ?? null;
    this.expected = details.expected ?? null;
    this.received = details.received ?? null;
  }

  toBody(): ApiErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      field: this.field,
      expected: this.expected,
      received: this.received
    };
  }
}

export type AuditorAuthOptions = {
  repository: AuditorRepository;
  publicOrigin: string;
  cookiePath?: string;
  now?: () => Date;
};

export class AuditorAuth {
  readonly publicOrigin: string;
  readonly cookieName = "agentpay_session";
  readonly cookiePath: string;

  private readonly repository: AuditorRepository;
  private readonly now: () => Date;
  private readonly domain: string;

  constructor(options: AuditorAuthOptions) {
    const origin = new URL(options.publicOrigin);
    if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost") {
      throw new TypeError("AgentPay public origin must use HTTPS outside localhost");
    }
    if (origin.origin !== options.publicOrigin) {
      throw new TypeError("AgentPay public origin must not include a path, query, or trailing slash");
    }
    this.repository = options.repository;
    this.publicOrigin = origin.origin;
    this.cookiePath = sessionCookiePath(options.cookiePath ?? "/v1");
    this.domain = origin.host;
    this.now = options.now ?? (() => new Date());
  }

  issueChallenge(input: {
    operatorPublicKey: string;
    origin: string;
    purpose: "session" | "operator_action";
    action?: OperatorActionDescriptor;
  }): { challenge: AuthChallenge; message: string } {
    this.requireOrigin(input.origin);
    const operatorPublicKey = parseCasperPublicKey(input.operatorPublicKey).publicKeyHex;
    const requestedAction = challengeRequestedAction(input.purpose, input.action);
    const issuedAt = this.nowDate();
    const challengeBase = {
      id: randomUUID(),
      operatorPublicKey,
      origin: this.publicOrigin,
      purpose: input.purpose,
      nonce: randomBytes(32).toString("hex"),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + CHALLENGE_TTL_MS).toISOString(),
      usedAt: null
    };
    const message = challengeMessage(challengeBase, this.domain, requestedAction);
    const challenge: AuthChallenge = { ...challengeBase, action: message };
    if (!this.repository.saveChallenge(challenge)) {
      throw new AuthError("challenge_conflict", "Could not issue a unique authentication challenge", 503, {
        retryable: true
      });
    }
    return { challenge, message };
  }

  createSession(input: {
    challengeId: string;
    operatorPublicKey: string;
    origin: string;
    signature: string;
  }): { session: AuthSession; token: string } {
    const challenge = this.requireUsableChallenge(
      input.challengeId,
      input.operatorPublicKey,
      input.origin,
      "session"
    );
    this.verifySignature(challenge, input.signature);
    this.consumeChallenge(challenge);

    const now = this.nowDate();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const session: AuthSession = {
        id: randomUUID(),
        operatorPublicKey: challenge.operatorPublicKey,
        tokenHash: hashBearerToken(token),
        origin: challenge.origin,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        revokedAt: null
      };
      if (this.repository.saveSession(session)) return { session, token };
    }
    throw new AuthError("session_conflict", "Could not issue a unique operator session", 503, {
      retryable: true
    });
  }

  verifyOperatorAction(input: {
    challengeId: string;
    operatorPublicKey: string;
    origin: string;
    action: OperatorActionDescriptor;
    signature: string;
  }): { message: string } {
    validateOperatorAction(input.action);
    const challenge = this.requireUsableChallenge(
      input.challengeId,
      input.operatorPublicKey,
      input.origin,
      "operator_action"
    );
    const expectedMessage = challengeMessage(challenge, this.domain, input.action);
    if (!constantTimeStringEqual(challenge.action, expectedMessage)) {
      throw new AuthError(
        "signed_action_mismatch",
        "The signed challenge does not describe this exact operator action",
        401,
        { field: "action", expected: "challenge-bound artifact", received: input.action }
      );
    }
    this.verifySignature(challenge, input.signature);
    this.consumeChallenge(challenge);
    return { message: challenge.action };
  }

  authenticateCredential(rawToken: string): AuthPrincipal {
    const tokenHash = hashBearerToken(rawToken);
    const session = this.repository.findSessionByTokenHash(tokenHash);
    if (session) {
      ensureTokenHash(session.tokenHash, tokenHash);
      if (session.revokedAt !== null) {
        throw new AuthError("session_revoked", "Operator session has been revoked", 401);
      }
      if (Date.parse(session.expiresAt) <= this.nowDate().getTime()) {
        throw new AuthError("session_expired", "Operator session has expired", 401);
      }
      return { kind: "operator", session };
    }

    const agentToken = this.repository.findAgentTokenByHash(tokenHash);
    if (agentToken) {
      ensureTokenHash(agentToken.tokenHash, tokenHash);
      this.requireActiveAgentToken(agentToken);
      return { kind: "agent", token: agentToken };
    }
    throw new AuthError("invalid_credentials", "Credential is invalid or no longer available", 401);
  }

  authorizeAgent(
    rawToken: string,
    scope: AgentTokenScope,
    payerPublicKey?: string
  ): AgentTokenRecord {
    const principal = this.authenticateCredential(rawToken);
    if (principal.kind !== "agent") {
      throw new AuthError("agent_token_required", "This operation requires an AgentPay agent token", 403);
    }
    if (!principal.token.scopes.includes(scope)) {
      throw new AuthError("agent_scope_denied", "Agent token does not include the required scope", 403, {
        field: "scope",
        expected: scope,
        received: principal.token.scopes
      });
    }
    if (payerPublicKey !== undefined) {
      const normalized = parseCasperPublicKey(payerPublicKey).publicKeyHex;
      if (!principal.token.allowedPayerPublicKeys.includes(normalized)) {
        throw new AuthError("payer_not_allowed", "Agent token is not bound to this payer public key", 403, {
          field: "payerPublicKey",
          expected: principal.token.allowedPayerPublicKeys,
          received: normalized
        });
      }
    }
    return principal.token;
  }

  sessionCookie(token: string, expiresAt: string): string {
    const maximumAge = Math.max(0, Math.floor((Date.parse(expiresAt) - this.nowDate().getTime()) / 1_000));
    return `${this.cookieName}=${token}; Path=${this.cookiePath}; Max-Age=${maximumAge}; HttpOnly; Secure; SameSite=Strict`;
  }

  currentTime(): string {
    return this.nowDate().toISOString();
  }

  private requireUsableChallenge(
    challengeId: string,
    operatorPublicKey: string,
    origin: string,
    purpose: AuthChallenge["purpose"]
  ): AuthChallenge {
    this.requireOrigin(origin);
    const challenge = this.repository.getChallenge(challengeId);
    if (!challenge) throw new AuthError("challenge_not_found", "Authentication challenge was not found", 401);
    if (challenge.usedAt !== null) {
      throw new AuthError("challenge_replayed", "Authentication challenge has already been used", 409);
    }
    if (challenge.purpose !== purpose) {
      throw new AuthError("challenge_purpose_mismatch", "Authentication challenge has the wrong purpose", 401);
    }
    const normalizedKey = parseCasperPublicKey(operatorPublicKey).publicKeyHex;
    if (challenge.operatorPublicKey !== normalizedKey) {
      throw new AuthError("challenge_operator_mismatch", "Authentication challenge belongs to another operator", 401);
    }
    if (challenge.origin !== origin) {
      throw new AuthError("origin_mismatch", "Authentication challenge belongs to another origin", 403);
    }
    const now = this.nowDate().getTime();
    if (Date.parse(challenge.expiresAt) <= now) {
      throw new AuthError("challenge_expired", "Authentication challenge has expired", 401);
    }
    if (Date.parse(challenge.issuedAt) > now) {
      throw new AuthError("challenge_not_yet_valid", "Authentication challenge is not valid yet", 401);
    }
    return challenge;
  }

  private consumeChallenge(challenge: AuthChallenge): void {
    if (!this.repository.consumeChallenge(challenge.id, this.nowDate().toISOString())) {
      throw new AuthError("challenge_replayed", "Authentication challenge has already been used", 409);
    }
  }

  private verifySignature(challenge: AuthChallenge, signature: string): void {
    if (
      !verifyCasperMessageSignature({
        message: challenge.action,
        publicKeyHex: challenge.operatorPublicKey,
        signatureHex: signature
      })
    ) {
      throw new AuthError("invalid_signature", "Casper message signature is invalid", 401);
    }
  }

  private requireActiveAgentToken(token: AgentTokenRecord): void {
    if (token.revokedAt !== null) {
      throw new AuthError("agent_token_revoked", "Agent token has been revoked", 401);
    }
    if (token.expiresAt !== null && Date.parse(token.expiresAt) <= this.nowDate().getTime()) {
      throw new AuthError("agent_token_expired", "Agent token has expired", 401);
    }
  }

  private requireOrigin(origin: string): void {
    if (origin !== this.publicOrigin) {
      throw new AuthError("origin_mismatch", "Request Origin does not match this AgentPay deployment", 403, {
        field: "Origin",
        expected: this.publicOrigin,
        received: origin || null
      });
    }
  }

  private nowDate(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError("Auditor authentication clock returned an invalid date");
    }
    return value;
  }
}

export function hashBearerToken(token: string): string {
  if (typeof token !== "string" || token.length < 32 || token.length > 512) {
    throw new AuthError("invalid_credentials", "Credential is invalid or no longer available", 401);
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function agentTokenIssueHash(spec: AgentTokenIssueSpec): string {
  return artifactHash({ kind: "agent_token_issue", ...spec });
}

export function agentTokenRevokeHash(input: {
  operatorPublicKey: string;
  tokenId: string;
  revision: number;
}): string {
  return artifactHash({ kind: "agent_token_revoke", ...input });
}

function challengeRequestedAction(
  purpose: AuthChallenge["purpose"],
  action: OperatorActionDescriptor | undefined
): { kind: "session_create" } | OperatorActionDescriptor {
  if (purpose === "session") {
    if (action !== undefined) {
      throw new AuthError("invalid_challenge", "Session challenges cannot include an operator action", 400);
    }
    return { kind: "session_create" };
  }
  if (!action) {
    throw new AuthError("invalid_challenge", "Operator-action challenges require an action descriptor", 400);
  }
  validateOperatorAction(action);
  return action;
}

function validateOperatorAction(action: OperatorActionDescriptor): void {
  if (
    !["policy_revision", "provider_decision", "agent_token_issue", "agent_token_revoke"].includes(
      action.kind
    )
  ) {
    throw new AuthError("invalid_challenge", "Operator action kind is unsupported", 400);
  }
  if (!HASH.test(action.artifactHash)) {
    throw new AuthError("invalid_challenge", "Operator action artifact hash is malformed", 400);
  }
  if (!Number.isSafeInteger(action.revision) || action.revision <= 0) {
    throw new AuthError("invalid_challenge", "Operator action revision must be a positive integer", 400);
  }
}

function challengeMessage(
  challenge: Pick<
    AuthChallenge,
    "id" | "operatorPublicKey" | "origin" | "purpose" | "nonce" | "issuedAt" | "expiresAt"
  >,
  domain: string,
  requestedAction: { kind: "session_create" } | OperatorActionDescriptor
): string {
  return operatorActionMessage({
    kind: "agentpay_auth_challenge",
    version: 1,
    domain,
    origin: challenge.origin,
    network: "casper:casper-test",
    challengeId: challenge.id,
    operatorPublicKey: challenge.operatorPublicKey,
    purpose: challenge.purpose,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    requestedAction
  });
}

function ensureTokenHash(stored: string, computed: string): void {
  if (!constantTimeHexEqual(stored, computed)) {
    throw new AuthError("invalid_credentials", "Credential is invalid or no longer available", 401);
  }
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!HASH.test(left) || !HASH.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionCookiePath(value: string): string {
  if (!/^\/[A-Za-z0-9._~!$&'()*+,=:@%/-]*$/.test(value)) {
    throw new TypeError("AgentPay session cookie path must be an absolute URL path without a query or fragment");
  }
  return value;
}
