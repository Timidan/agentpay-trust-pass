import { randomBytes, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  operatorPolicyHash,
  parseCasperPublicKey,
  providerDecisionHash,
  verifyPurchaseReceipt,
  type OperatorPolicy,
  type ProviderDecision
} from "@agent-pay/core";
import {
  AuditorAuth,
  AuthError,
  agentTokenIssueHash,
  agentTokenRevokeHash,
  hashBearerToken,
  type AgentTokenIssueSpec,
  type AuthPrincipal,
  type OperatorActionDescriptor
} from "./auth.js";
import type {
  AgentTokenRecord,
  AgentTokenScope,
  AuditorRepository,
  AuthSession
} from "./repository.js";
import type { X402Probe } from "./probe.js";
import { PaymentAuditService } from "./service.js";

const HASH = /^[0-9a-f]{64}$/;
const ACCOUNT_ADDRESS = /^00[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const SIGNATURE = /^(?:01|02)?[0-9a-f]{128}$/;
const AGENT_SCOPES = new Set<AgentTokenScope>([
  "checks:write",
  "settlements:write",
  "observations:write",
  "receipts:read"
]);

export type AuditorRouterDependencies = {
  repository: AuditorRepository;
  auth: AuditorAuth;
  service?: PaymentAuditService;
  probe?: X402Probe;
};

export function createAuditorRouter(dependencies: AuditorRouterDependencies): Router {
  const router = Router();
  const { repository, auth } = dependencies;

  router.post("/auth/challenges", (request, response) => {
    const body = bodyRecord(request);
    const purpose = requiredString(body, "purpose");
    if (purpose !== "session" && purpose !== "operator_action") {
      throw invalid("invalid_challenge", "Challenge purpose is unsupported", "purpose", ["session", "operator_action"], purpose);
    }
    const issued = auth.issueChallenge({
      operatorPublicKey: requiredString(body, "operatorPublicKey"),
      origin: requestOrigin(request),
      purpose,
      action: purpose === "operator_action" ? parseActionDescriptor(body.action) : undefined
    });
    response.status(201).json({
      challengeId: issued.challenge.id,
      operatorPublicKey: issued.challenge.operatorPublicKey,
      purpose: issued.challenge.purpose,
      nonce: issued.challenge.nonce,
      message: issued.message,
      issuedAt: issued.challenge.issuedAt,
      expiresAt: issued.challenge.expiresAt
    });
  });

  router.post("/auth/sessions", (request, response) => {
    const body = bodyRecord(request);
    const created = auth.createSession({
      challengeId: requiredString(body, "challengeId"),
      operatorPublicKey: requiredString(body, "operatorPublicKey"),
      origin: requestOrigin(request),
      signature: requiredString(body, "signature")
    });
    response.setHeader("Set-Cookie", auth.sessionCookie(created.token, created.session.expiresAt));
    response.status(201).json({
      token: created.token,
      operatorPublicKey: created.session.operatorPublicKey,
      expiresAt: created.session.expiresAt
    });
  });

  router.get("/policies/current", (request, response) => {
    const session = requireOperator(request, auth);
    const policy = repository.getCurrentPolicy(session.operatorPublicKey);
    if (!policy) throw new AuthError("policy_not_found", "No signed operator policy is installed", 404);
    response.json({ policy });
  });

  router.post("/policies/revisions", (request, response) => {
    const session = requireOperator(request, auth);
    const body = bodyRecord(request);
    const policy = parsePolicy(body.policy);
    requireArtifactOperator(session, policy.operatorPublicKey);
    const expectedRevision = repository.latestPolicyRevision(session.operatorPublicKey) + 1;
    requireRevision("policy", expectedRevision, policy.revision);
    const computedHash = operatorPolicyHash(policy);
    if (computedHash !== policy.policyHash) {
      throw invalid(
        "policy_hash_mismatch",
        "Policy hash does not match its canonical content",
        "policy.policyHash",
        computedHash,
        policy.policyHash
      );
    }
    const verified = auth.verifyOperatorAction({
      challengeId: requiredString(body, "challengeId"),
      operatorPublicKey: session.operatorPublicKey,
      origin: requestOrigin(request),
      action: { kind: "policy_revision", artifactHash: policy.policyHash, revision: policy.revision },
      signature: policy.signature
    });
    requireSignatureMessage("policy", verified.message, policy.signatureMessage);
    if (!repository.savePolicy(policy)) {
      throw conflict("policy_revision_conflict", "Policy revision already exists", "policy.revision", expectedRevision, policy.revision);
    }
    response.status(201).json({ policy });
  });

  router.get("/provider-decisions", (request, response) => {
    const session = requireOperator(request, auth);
    response.json({ decisions: repository.listProviderDecisions(session.operatorPublicKey) });
  });

  router.post("/provider-decisions", (request, response) => {
    const session = requireOperator(request, auth);
    const body = bodyRecord(request);
    const decision = parseProviderDecision(body.decision);
    requireArtifactOperator(session, decision.operatorPublicKey);
    const expectedRevision = repository.latestProviderDecisionRevision(session.operatorPublicKey) + 1;
    requireRevision("providerDecision", expectedRevision, decision.revision);
    const computedHash = providerDecisionHash(decision);
    if (computedHash !== decision.decisionHash) {
      throw invalid(
        "provider_decision_hash_mismatch",
        "Provider decision hash does not match its canonical content",
        "decision.decisionHash",
        computedHash,
        decision.decisionHash
      );
    }
    const verified = auth.verifyOperatorAction({
      challengeId: requiredString(body, "challengeId"),
      operatorPublicKey: session.operatorPublicKey,
      origin: requestOrigin(request),
      action: {
        kind: "provider_decision",
        artifactHash: decision.decisionHash,
        revision: decision.revision
      },
      signature: decision.signature
    });
    requireSignatureMessage("decision", verified.message, decision.signatureMessage);
    if (!repository.saveProviderDecision(decision)) {
      throw conflict(
        "provider_revision_conflict",
        "Provider decision revision already exists",
        "decision.revision",
        expectedRevision,
        decision.revision
      );
    }
    response.status(201).json({ decision });
  });

  router.post("/agent-tokens", (request, response) => {
    const session = requireOperator(request, auth);
    const body = bodyRecord(request);
    const spec = parseAgentTokenSpec(body.spec);
    requireArtifactOperator(session, spec.operatorPublicKey);
    const expectedRevision = repository.latestAgentTokenRevision(session.operatorPublicKey) + 1;
    requireRevision("agentToken", expectedRevision, spec.revision);
    const actionHash = agentTokenIssueHash(spec);
    const signature = normalizedSignature(requiredString(body, "signature"), "signature");
    auth.verifyOperatorAction({
      challengeId: requiredString(body, "challengeId"),
      operatorPublicKey: session.operatorPublicKey,
      origin: requestOrigin(request),
      action: { kind: "agent_token_issue", artifactHash: actionHash, revision: spec.revision },
      signature
    });

    const now = auth.currentTime();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const record: AgentTokenRecord = {
        id: randomUUID(),
        ...spec,
        tokenHash: hashBearerToken(token),
        actionHash,
        signature,
        createdAt: now,
        revokedAt: null
      };
      if (repository.saveAgentToken(record)) {
        const { tokenHash: _tokenHash, ...publicRecord } = record;
        response.status(201).json({ token, record: publicRecord });
        return;
      }
    }
    throw new AuthError("agent_token_conflict", "Could not issue a unique agent token", 409);
  });

  router.delete("/agent-tokens/:id", (request, response) => {
    const session = requireOperator(request, auth);
    const token = repository.getAgentToken(request.params.id);
    if (!token) throw new AuthError("agent_token_not_found", "Agent token was not found", 404);
    requireArtifactOperator(session, token.operatorPublicKey);
    if (token.revokedAt !== null) throw new AuthError("agent_token_revoked", "Agent token has already been revoked", 409);
    const body = bodyRecord(request);
    const revision = positiveInteger(body.revision, "revision");
    const expectedRevision = repository.latestAgentTokenRevision(session.operatorPublicKey) + 1;
    requireRevision("agentToken", expectedRevision, revision);
    const actionHash = agentTokenRevokeHash({
      operatorPublicKey: session.operatorPublicKey,
      tokenId: token.id,
      revision
    });
    auth.verifyOperatorAction({
      challengeId: requiredString(body, "challengeId"),
      operatorPublicKey: session.operatorPublicKey,
      origin: requestOrigin(request),
      action: { kind: "agent_token_revoke", artifactHash: actionHash, revision },
      signature: normalizedSignature(requiredString(body, "signature"), "signature")
    });
    if (!repository.revokeAgentToken({
      tokenId: token.id,
      operatorPublicKey: session.operatorPublicKey,
      revision,
      actionHash,
      signature: normalizedSignature(requiredString(body, "signature"), "signature"),
      revokedAt: auth.currentTime()
    })) {
      throw new AuthError("agent_token_revoked", "Agent token has already been revoked", 409);
    }
    response.status(204).send();
  });

  const probe = dependencies.probe;
  if (probe) {
    router.post("/probes", async (request, response) => {
      const principal = authenticateRequest(request, auth).principal;
      requireAgentScope(principal, "checks:write", "Agent token cannot probe x402 services");
      response.json(await probe.probe(bodyRecord(request)));
    });
  }

  if (dependencies.service) {
    const service = dependencies.service;

    router.post("/checks", async (request, response) => {
      const body = bodyRecord(request);
      const actor = requireCheckActor(request, auth, body.authorization);
      const idempotencyKey = request.header("idempotency-key");
      if (!idempotencyKey || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
        throw invalid(
          "invalid_request",
          "Idempotency-Key must contain 1 to 128 URL-safe identifier characters",
          "Idempotency-Key",
          "1..128 characters",
          idempotencyKey ?? null
        );
      }
      const result = await service.createCheck({
        operatorPublicKey: actor.operatorPublicKey,
        agentTokenId: actor.agentTokenId,
        idempotencyKey,
        request: body.request,
        paymentRequired: body.paymentRequired,
        authorization: body.authorization
      });
      response.status(result.created ? 201 : 200).json(result);
    });

    router.get("/checks/:id", (request, response) => {
      const principal = authenticateRequest(request, auth).principal;
      const check = service.getCheck(request.params.id);
      if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
      requireCheckOwnership(principal, check.operatorPublicKey, check.agentTokenId);
      response.json({ check });
    });

    router.post("/checks/:id/cancel", (request, response) => {
      const principal = authenticateRequest(request, auth).principal;
      const check = service.getCheck(request.params.id);
      if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
      requireCheckOwnership(principal, check.operatorPublicKey, check.agentTokenId);
      if (principal.kind === "agent" && !principal.token.scopes.includes("checks:write")) {
        throw new AuthError("agent_scope_denied", "Agent token cannot cancel payment checks", 403, {
          field: "scope",
          expected: "checks:write",
          received: principal.token.scopes
        });
      }
      response.json({ check: service.cancelCheck(check.id) });
    });

    router.post("/checks/:id/verify-settlement", async (request, response) => {
      const principal = authenticateRequest(request, auth).principal;
      const check = service.getCheck(request.params.id);
      if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
      requireCheckOwnership(principal, check.operatorPublicKey, check.agentTokenId);
      requireAgentScope(principal, "settlements:write", "Agent token cannot verify settlements");
      const body = bodyRecord(request);
      const result = await service.verifySettlement(check.id, body.transactionHash);
      response.json(result);
    });

    router.post("/checks/:id/response-observations", (request, response) => {
      const principal = authenticateRequest(request, auth).principal;
      const check = service.getCheck(request.params.id);
      if (!check) throw new AuthError("check_not_found", "Payment check was not found", 404);
      requireCheckOwnership(principal, check.operatorPublicKey, check.agentTokenId);
      requireAgentScope(principal, "observations:write", "Agent token cannot record response observations");
      const result = service.recordResponseObservation(check.id, bodyRecord(request));
      response.status(result.created ? 201 : 200).json(result);
    });

    router.get("/receipts/:id", (request, response) => {
      if (typeof request.query.share === "string") {
        const receipt = service.getSharedReceipt(request.params.id, request.query.share);
        if (!receipt) throw new AuthError("receipt_not_found", "Purchase receipt was not found", 404);
        response.json({ receipt });
        return;
      }
      const principal = authenticateRequest(request, auth).principal;
      const receipt = service.getReceipt(request.params.id);
      if (!receipt) throw new AuthError("receipt_not_found", "Purchase receipt was not found", 404);
      const check = service.getCheck(receipt.checkId);
      if (!check) throw new AuthError("receipt_not_found", "Purchase receipt was not found", 404);
      requireCheckOwnership(principal, check.operatorPublicKey, check.agentTokenId);
      requireAgentScope(principal, "receipts:read", "Agent token cannot read purchase receipts");
      response.json({ receipt });
    });

    router.post("/receipts/:id/shares", (request, response) => {
      const session = requireOperator(request, auth);
      const body = bodyRecord(request);
      const created = service.createReceiptShare(request.params.id, session.operatorPublicKey, body.expiresAt);
      response.status(201).json({
        ...created,
        url: `${auth.publicOrigin}/v1/receipts/${encodeURIComponent(request.params.id)}?share=${encodeURIComponent(created.token)}`
      });
    });

    router.delete("/receipts/:id/shares/:shareId", (request, response) => {
      const session = requireOperator(request, auth);
      service.revokeReceiptShare(request.params.id, request.params.shareId, session.operatorPublicKey);
      response.status(204).send();
    });
  }

  router.post("/receipts/verify", (request, response) => {
    const body = bodyRecord(request);
    response.json(verifyPurchaseReceipt(body.receipt));
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AuthError) {
      response.status(error.status).json(error.toBody());
      return;
    }
    response.status(500).json({
      code: "internal_error",
      message: "AgentPay could not complete the request",
      retryable: false,
      field: null,
      expected: null,
      received: null
    });
  });

  return router;
}

type CredentialSource = "bearer" | "cookie";

function requireOperator(request: Request, auth: AuditorAuth): AuthSession {
  const { principal } = authenticateRequest(request, auth);
  if (principal.kind !== "operator") {
    throw new AuthError("operator_session_required", "Administrative actions require an operator session", 403);
  }
  return principal.session;
}

function authenticateRequest(
  request: Request,
  auth: AuditorAuth
): { principal: AuthPrincipal; credential: { token: string; source: CredentialSource } } {
  const credential = readCredential(request, auth.cookieName);
  const principal = auth.authenticateCredential(credential.token);
  if (
    principal.kind === "operator" &&
    credential.source === "cookie" &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method)
  ) {
    const origin = requestOrigin(request);
    if (origin !== principal.session.origin) {
      throw new AuthError("origin_mismatch", "Cookie-authenticated writes require the session Origin", 403, {
        field: "Origin",
        expected: principal.session.origin,
        received: origin || null
      });
    }
  }
  return { principal, credential };
}

function requireCheckActor(
  request: Request,
  auth: AuditorAuth,
  authorization: unknown
): { operatorPublicKey: string; agentTokenId: string | null } {
  const authenticated = authenticateRequest(request, auth);
  if (authenticated.principal.kind === "operator") {
    return {
      operatorPublicKey: authenticated.principal.session.operatorPublicKey,
      agentTokenId: null
    };
  }
  const authorizationRecord =
    typeof authorization === "object" && authorization !== null && !Array.isArray(authorization)
      ? (authorization as Record<string, unknown>)
      : null;
  if (!authorizationRecord || typeof authorizationRecord.payerPublicKey !== "string") {
    throw invalid(
      "invalid_request",
      "Agent checks require an authorization payer public key",
      "authorization.payerPublicKey",
      "Casper public key",
      authorizationRecord?.payerPublicKey ?? null
    );
  }
  const token = auth.authorizeAgent(
    authenticated.credential.token,
    "checks:write",
    authorizationRecord.payerPublicKey
  );
  return { operatorPublicKey: token.operatorPublicKey, agentTokenId: token.id };
}

function requireCheckOwnership(
  principal: AuthPrincipal,
  operatorPublicKey: string,
  agentTokenId: string | null
): void {
  const ownsCheck =
    principal.kind === "operator"
      ? principal.session.operatorPublicKey === operatorPublicKey
      : principal.token.operatorPublicKey === operatorPublicKey && principal.token.id === agentTokenId;
  if (!ownsCheck) throw new AuthError("check_not_found", "Payment check was not found", 404);
}

function requireAgentScope(principal: AuthPrincipal, scope: AgentTokenScope, message: string): void {
  if (principal.kind === "agent" && !principal.token.scopes.includes(scope)) {
    throw new AuthError("agent_scope_denied", message, 403, {
      field: "scope",
      expected: scope,
      received: principal.token.scopes
    });
  }
}

function readCredential(request: Request, cookieName: string): { token: string; source: CredentialSource } {
  const authorization = request.header("authorization");
  if (authorization) {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match) throw new AuthError("invalid_credentials", "Authorization header is malformed", 401);
    return { token: match[1], source: "bearer" };
  }
  const cookie = request.header("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const separator = part.indexOf("=");
      if (separator < 0) continue;
      if (part.slice(0, separator).trim() === cookieName) {
        const token = part.slice(separator + 1).trim();
        if (token) return { token, source: "cookie" };
      }
    }
  }
  throw new AuthError("missing_credentials", "A bearer token or AgentPay session cookie is required", 401);
}

function parsePolicy(value: unknown): OperatorPolicy {
  const input = record(value, "policy");
  return {
    policyId: boundedString(input.policyId, "policy.policyId", 1, 128),
    operatorPublicKey: publicKey(input.operatorPublicKey, "policy.operatorPublicKey"),
    revision: positiveInteger(input.revision, "policy.revision"),
    issuedAt: canonicalTimestamp(input.issuedAt, "policy.issuedAt"),
    effectiveAt: canonicalTimestamp(input.effectiveAt, "policy.effectiveAt"),
    allowedNetworks: networkArray(input.allowedNetworks, "policy.allowedNetworks"),
    allowedPayerPublicKeys: publicKeyArray(input.allowedPayerPublicKeys, "policy.allowedPayerPublicKeys"),
    assetDailyCaps: decimalMap(input.assetDailyCaps, "policy.assetDailyCaps"),
    maximumAuthorizationWindowSeconds: rangedInteger(
      input.maximumAuthorizationWindowSeconds,
      "policy.maximumAuthorizationWindowSeconds",
      1,
      900
    ),
    maximumConcurrentReservations: rangedInteger(
      input.maximumConcurrentReservations,
      "policy.maximumConcurrentReservations",
      1,
      10_000
    ),
    deniedOrigins: originArray(input.deniedOrigins, "policy.deniedOrigins"),
    deniedPayees: accountArray(input.deniedPayees, "policy.deniedPayees"),
    deniedAssets: hashArray(input.deniedAssets, "policy.deniedAssets"),
    evidenceMaxAgeSeconds: rangedInteger(input.evidenceMaxAgeSeconds, "policy.evidenceMaxAgeSeconds", 1, 86_400),
    reviewOnInvestmentAdvisories: booleanValue(input.reviewOnInvestmentAdvisories, "policy.reviewOnInvestmentAdvisories"),
    allowPinnedResourceSchemeMismatch: booleanValue(input.allowPinnedResourceSchemeMismatch, "policy.allowPinnedResourceSchemeMismatch"),
    signatureMessage: boundedString(input.signatureMessage, "policy.signatureMessage", 1, 10_000),
    signature: normalizedSignature(input.signature, "policy.signature"),
    policyHash: hashValue(input.policyHash, "policy.policyHash")
  };
}

function parseProviderDecision(value: unknown): ProviderDecision {
  const input = record(value, "decision");
  const kind = input.kind;
  if (kind !== "pin" && kind !== "deny") {
    throw invalid("invalid_request", "Provider decision kind is invalid", "decision.kind", ["pin", "deny"], kind);
  }
  const resourcePathPrefix = input.resourcePathPrefix;
  if (resourcePathPrefix !== null && (typeof resourcePathPrefix !== "string" || !resourcePathPrefix.startsWith("/"))) {
    throw invalid("invalid_request", "Resource path prefix must start with / or be null", "decision.resourcePathPrefix", "/path or null", resourcePathPrefix);
  }
  return {
    decisionId: boundedString(input.decisionId, "decision.decisionId", 1, 128),
    kind,
    operatorPublicKey: publicKey(input.operatorPublicKey, "decision.operatorPublicKey"),
    revision: positiveInteger(input.revision, "decision.revision"),
    origin: exactOrigin(input.origin, "decision.origin"),
    payee: accountAddress(input.payee, "decision.payee"),
    asset: hashValue(input.asset, "decision.asset"),
    network: network(input.network, "decision.network"),
    resourcePathPrefix,
    perCallCeiling: decimalString(input.perCallCeiling, "decision.perCallCeiling", false),
    expiresAt: canonicalTimestamp(input.expiresAt, "decision.expiresAt"),
    promptedByCheckId: boundedString(input.promptedByCheckId, "decision.promptedByCheckId", 1, 128),
    signatureMessage: boundedString(input.signatureMessage, "decision.signatureMessage", 1, 10_000),
    signature: normalizedSignature(input.signature, "decision.signature"),
    decisionHash: hashValue(input.decisionHash, "decision.decisionHash")
  };
}

function parseAgentTokenSpec(value: unknown): AgentTokenIssueSpec {
  const input = record(value, "spec");
  const scopes = stringArray(input.scopes, "spec.scopes").map((scope) => {
    if (!AGENT_SCOPES.has(scope as AgentTokenScope)) {
      throw invalid("invalid_request", "Agent token scope is unsupported", "spec.scopes", [...AGENT_SCOPES], scope);
    }
    return scope as AgentTokenScope;
  });
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    throw invalid("invalid_request", "Agent token scopes must be non-empty and unique", "spec.scopes", "unique scopes", scopes);
  }
  const expiresAt = input.expiresAt === null ? null : canonicalTimestamp(input.expiresAt, "spec.expiresAt");
  return {
    operatorPublicKey: publicKey(input.operatorPublicKey, "spec.operatorPublicKey"),
    revision: positiveInteger(input.revision, "spec.revision"),
    agentName: boundedString(input.agentName, "spec.agentName", 1, 100),
    scopes,
    allowedPayerPublicKeys: publicKeyArray(input.allowedPayerPublicKeys, "spec.allowedPayerPublicKeys"),
    expiresAt
  };
}

function parseActionDescriptor(value: unknown): OperatorActionDescriptor {
  const input = record(value, "action");
  const kind = requiredString(input, "kind") as OperatorActionDescriptor["kind"];
  return {
    kind,
    artifactHash: hashValue(input.artifactHash, "action.artifactHash"),
    revision: positiveInteger(input.revision, "action.revision")
  };
}

function requireArtifactOperator(session: AuthSession, operatorPublicKey: string): void {
  if (session.operatorPublicKey !== operatorPublicKey) {
    throw new AuthError("operator_mismatch", "Signed artifact belongs to another operator", 403, {
      field: "operatorPublicKey",
      expected: session.operatorPublicKey,
      received: operatorPublicKey
    });
  }
}

function requireRevision(label: string, expected: number, received: number): void {
  if (expected !== received) {
    throw conflict(
      label === "policy" ? "policy_revision_conflict" : `${label}_revision_conflict`,
      "Signed revision must increment by exactly one",
      `${label}.revision`,
      expected,
      received
    );
  }
}

function requireSignatureMessage(label: string, expected: string, received: string): void {
  if (expected !== received) {
    throw invalid(
      "signed_action_mismatch",
      "Stored signature message does not match the consumed operator challenge",
      `${label}.signatureMessage`,
      expected,
      received
    );
  }
}

function bodyRecord(request: Request): Record<string, unknown> {
  return record(request.body, "body");
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("invalid_request", `${field} must be an object`, field, "object", value);
  }
  return value as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, field: string): string {
  return boundedString(input[field], field, 1, 10_000);
}

function boundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw invalid("invalid_request", `${field} has an invalid length`, field, `${minimum}..${maximum} characters`, value);
  }
  return value;
}

function publicKey(value: unknown, field: string): string {
  try {
    return parseCasperPublicKey(boundedString(value, field, 66, 68)).publicKeyHex;
  } catch {
    throw invalid("invalid_request", `${field} is not a tagged Casper public key`, field, "Casper public key", value);
  }
}

function publicKeyArray(value: unknown, field: string): string[] {
  const values = array(value, field).map((item) => publicKey(item, field));
  if (new Set(values).size !== values.length) throw invalid("invalid_request", `${field} must not contain duplicates`, field, "unique public keys", value);
  return values;
}

function hashValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw invalid("invalid_request", `${field} must be lowercase 64-character hexadecimal`, field, "64 lowercase hex", value);
  }
  return value;
}

function hashArray(value: unknown, field: string): string[] {
  const values = array(value, field).map((item) => hashValue(item, field));
  return unique(values, field);
}

function accountAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !ACCOUNT_ADDRESS.test(value)) {
    throw invalid("invalid_request", `${field} must be a Casper account address`, field, "00 + 64 lowercase hex", value);
  }
  return value;
}

function accountArray(value: unknown, field: string): string[] {
  return unique(array(value, field).map((item) => accountAddress(item, field)), field);
}

function network(value: unknown, field: string): "casper:casper-test" {
  if (value !== "casper:casper-test") {
    throw invalid("invalid_request", `${field} is unsupported`, field, "casper:casper-test", value);
  }
  return value;
}

function networkArray(value: unknown, field: string): Array<"casper:casper-test"> {
  return unique(array(value, field).map((item) => network(item, field)), field);
}

function exactOrigin(value: unknown, field: string): string {
  const string = boundedString(value, field, 8, 2_048);
  try {
    const parsed = new URL(string);
    if (parsed.origin !== string || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) throw new Error();
    return string;
  } catch {
    throw invalid("invalid_request", `${field} must be an exact HTTP(S) origin`, field, "https://host", value);
  }
}

function originArray(value: unknown, field: string): string[] {
  return unique(array(value, field).map((item) => exactOrigin(item, field)), field);
}

function decimalMap(value: unknown, field: string): Record<string, string> {
  const input = record(value, field);
  const output: Record<string, string> = {};
  for (const [asset, cap] of Object.entries(input)) {
    const normalizedAsset = hashValue(asset, `${field}.asset`);
    output[normalizedAsset] = decimalString(cap, `${field}.${asset}`, true);
  }
  return output;
}

function decimalString(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || (!allowZero && value === "0")) {
    throw invalid("invalid_request", `${field} must be a canonical decimal amount`, field, allowZero ? "non-negative decimal" : "positive decimal", value);
  }
  return value;
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalid("invalid_request", `${field} must be a timestamp`, field, "ISO timestamp", value);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw invalid("invalid_request", `${field} must be a canonical ISO timestamp`, field, "YYYY-MM-DDTHH:mm:ss.sssZ", value);
  }
  return value;
}

function normalizedSignature(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalid("invalid_request", `${field} must be hexadecimal`, field, "Casper signature", value);
  const normalized = value.toLowerCase().replace(/^0x/, "");
  if (!SIGNATURE.test(normalized)) throw invalid("invalid_request", `${field} is malformed`, field, "Casper signature", value);
  return normalized;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid("invalid_request", `${field} must be boolean`, field, "boolean", value);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  return rangedInteger(value, field, 1, Number.MAX_SAFE_INTEGER);
}

function rangedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalid("invalid_request", `${field} is outside its supported range`, field, `${minimum}..${maximum}`, value);
  }
  return value;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > 1_000) throw invalid("invalid_request", `${field} must be an array`, field, "array", value);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item) => boundedString(item, field, 1, 100));
}

function unique<T>(values: T[], field: string): T[] {
  if (new Set(values).size !== values.length) throw invalid("invalid_request", `${field} must not contain duplicates`, field, "unique values", values);
  return values;
}

function requestOrigin(request: Request): string {
  return request.header("origin") ?? "";
}

function invalid(
  code: string,
  message: string,
  field: string,
  expected: unknown,
  received: unknown
): AuthError {
  return new AuthError(code, message, 400, { field, expected, received });
}

function conflict(
  code: string,
  message: string,
  field: string,
  expected: unknown,
  received: unknown
): AuthError {
  return new AuthError(code, message, 409, { field, expected, received });
}
