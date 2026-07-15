import express, { type Express } from "express";
import { ed25519 } from "@noble/curves/ed25519";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  operatorPolicyHash,
  providerDecisionHash,
  type OperatorPolicy,
  type ProviderDecision
} from "@agent-pay/core";
import {
  AuditorAuth,
  agentTokenIssueHash,
  agentTokenRevokeHash,
  type AgentTokenIssueSpec,
  type OperatorActionDescriptor
} from "../../src/auditor/auth.js";
import { createAuditorRouter } from "../../src/auditor/routes.js";
import { openSqliteRepository, type SqliteAuditorRepository } from "../../src/auditor/sqliteRepository.js";

const ORIGIN = "https://agentpay.example";
const NOW = "2026-07-15T21:00:00.000Z";
const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const OTHER_PRIVATE_KEY = new Uint8Array(32).fill(9);
const OPERATOR = `01${Buffer.from(ed25519.getPublicKey(PRIVATE_KEY)).toString("hex")}`;
const OTHER_OPERATOR = `01${Buffer.from(ed25519.getPublicKey(OTHER_PRIVATE_KEY)).toString("hex")}`;
const PAYER = `01${Buffer.from(ed25519.getPublicKey(new Uint8Array(32).fill(7))).toString("hex")}`;
const ASSET = "5".repeat(64);
const PAYEE = `00${"6".repeat(64)}`;
const repositories: SqliteAuditorRepository[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
});

describe("signed operator routes", () => {
  it("rejects policy writes without an operator session using the stable error shape", async () => {
    const context = createContext();

    const response = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Origin", ORIGIN)
      .send({})
      .expect(401);

    expect(response.body).toEqual({
      code: "missing_credentials",
      message: "A bearer token or AgentPay session cookie is required",
      retryable: false,
      field: null,
      expected: null,
      received: null
    });
  });

  it("installs one exact signed policy revision and rejects its replay", async () => {
    const context = createContext();
    const session = await createSession(context.app);
    const policy = policyRevision(1);
    const signed = await signArtifact(context.app, session.authorization, policyAction(policy));
    policy.signatureMessage = signed.message;
    policy.signature = signMessage(signed.message);

    const created = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({ challengeId: signed.challengeId, policy })
      .expect(201);
    expect(created.body.policy).toEqual(policy);

    const current = await request(context.app)
      .get("/v1/policies/current")
      .set("Authorization", session.authorization)
      .expect(200);
    expect(current.body.policy).toEqual(policy);

    const replay = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({ challengeId: signed.challengeId, policy })
      .expect(409);
    expect(replay.body.code).toBe("policy_revision_conflict");
  });

  it("rejects revision skips and policy content altered after challenge signing", async () => {
    const context = createContext();
    const session = await createSession(context.app);
    const skipped = policyRevision(2);
    const skippedChallenge = await signArtifact(context.app, session.authorization, policyAction(skipped));
    skipped.signatureMessage = skippedChallenge.message;
    skipped.signature = signMessage(skippedChallenge.message);

    const revisionResponse = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({ challengeId: skippedChallenge.challengeId, policy: skipped })
      .expect(409);
    expect(revisionResponse.body).toMatchObject({
      code: "policy_revision_conflict",
      field: "policy.revision",
      expected: 1,
      received: 2
    });

    const policy = policyRevision(1);
    const signed = await signArtifact(context.app, session.authorization, policyAction(policy));
    policy.signatureMessage = signed.message;
    policy.signature = signMessage(signed.message);
    policy.assetDailyCaps[ASSET] = "999999";

    const altered = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({ challengeId: signed.challengeId, policy })
      .expect(400);
    expect(altered.body.code).toBe("policy_hash_mismatch");
  });

  it("rejects an artifact owned by a different public key", async () => {
    const context = createContext();
    const session = await createSession(context.app);
    const policy = policyRevision(1, OTHER_OPERATOR);
    const signed = await signArtifact(context.app, session.authorization, policyAction(policy), OTHER_PRIVATE_KEY);
    policy.signatureMessage = signed.message;
    policy.signature = signMessage(signed.message, OTHER_PRIVATE_KEY);

    const response = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({ challengeId: signed.challengeId, policy })
      .expect(403);
    expect(response.body.code).toBe("operator_mismatch");
  });

  it("persists signed provider pins and denies agent tokens from administrative routes", async () => {
    const context = createContext();
    const session = await createSession(context.app);
    const decision = providerPin(1);
    const pinChallenge = await signArtifact(context.app, session.authorization, providerAction(decision));
    decision.signatureMessage = pinChallenge.message;
    decision.signature = signMessage(pinChallenge.message);

    await request(context.app)
      .post("/v1/provider-decisions")
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({ challengeId: pinChallenge.challengeId, decision })
      .expect(201);

    const listed = await request(context.app)
      .get("/v1/provider-decisions")
      .set("Authorization", session.authorization)
      .expect(200);
    expect(listed.body.decisions).toEqual([decision]);

    const issuedToken = await issueAgentToken(context.app, session.authorization, 1, ["checks:write"]);
    const secondDecision = providerPin(2);
    const secondChallenge = await signArtifact(context.app, session.authorization, providerAction(secondDecision));
    secondDecision.signatureMessage = secondChallenge.message;
    secondDecision.signature = signMessage(secondChallenge.message);

    const forbidden = await request(context.app)
      .post("/v1/provider-decisions")
      .set("Authorization", `Bearer ${issuedToken.token}`)
      .set("Origin", ORIGIN)
      .send({ challengeId: secondChallenge.challengeId, decision: secondDecision })
      .expect(403);
    expect(forbidden.body.code).toBe("operator_session_required");
  });

  it("issues a token once, stores only its hash, and revokes it with another signed action", async () => {
    const context = createContext();
    const session = await createSession(context.app);
    const issued = await issueAgentToken(
      context.app,
      session.authorization,
      1,
      ["checks:write", "settlements:write"]
    );

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = context.repository.getAgentToken(issued.record.id);
    expect(stored?.tokenHash).not.toBe(issued.token);
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    const revision = 2;
    const actionHash = agentTokenRevokeHash({
      operatorPublicKey: OPERATOR,
      tokenId: issued.record.id,
      revision
    });
    const action: OperatorActionDescriptor = {
      kind: "agent_token_revoke",
      artifactHash: actionHash,
      revision
    };
    const challenge = await signArtifact(context.app, session.authorization, action);

    await request(context.app)
      .delete(`/v1/agent-tokens/${issued.record.id}`)
      .set("Authorization", session.authorization)
      .set("Origin", ORIGIN)
      .send({
        challengeId: challenge.challengeId,
        revision,
        signature: signMessage(challenge.message)
      })
      .expect(204);

    expect(context.repository.getAgentToken(issued.record.id)?.revokedAt).toBe(NOW);
    expect(() => context.auth.authorizeAgent(issued.token, "checks:write", PAYER)).toThrowError(
      expect.objectContaining({ code: "agent_token_revoked" })
    );

    const next = await issueAgentToken(context.app, session.authorization, 3, ["checks:write"]);
    expect(next.record.id).not.toBe(issued.record.id);
  });

  it("sets hardened session cookies and enforces Origin on cookie-authenticated writes", async () => {
    const context = createContext();
    const session = await createSession(context.app);
    expect(session.cookie).toMatch(/HttpOnly/i);
    expect(session.cookie).toMatch(/Secure/i);
    expect(session.cookie).toMatch(/SameSite=Strict/i);

    const policy = policyRevision(1);
    const signed = await signArtifact(context.app, session.authorization, policyAction(policy));
    policy.signatureMessage = signed.message;
    policy.signature = signMessage(signed.message);

    const response = await request(context.app)
      .post("/v1/policies/revisions")
      .set("Cookie", session.cookie)
      .set("Origin", "https://attacker.example")
      .send({ challengeId: signed.challengeId, policy })
      .expect(403);
    expect(response.body.code).toBe("origin_mismatch");
  });
});

function createContext(): {
  app: Express;
  auth: AuditorAuth;
  repository: SqliteAuditorRepository;
} {
  const repository = openSqliteRepository(":memory:", { now: () => new Date(NOW) });
  repositories.push(repository);
  const auth = new AuditorAuth({ repository, publicOrigin: ORIGIN, now: () => new Date(NOW) });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/v1", createAuditorRouter({ repository, auth }));
  return { app, auth, repository };
}

async function createSession(app: Express): Promise<{ authorization: string; cookie: string }> {
  const challenge = await request(app)
    .post("/v1/auth/challenges")
    .set("Origin", ORIGIN)
    .send({ operatorPublicKey: OPERATOR, purpose: "session" })
    .expect(201);
  const session = await request(app)
    .post("/v1/auth/sessions")
    .set("Origin", ORIGIN)
    .send({
      challengeId: challenge.body.challengeId,
      operatorPublicKey: OPERATOR,
      signature: signMessage(challenge.body.message)
    })
    .expect(201);
  const cookie = session.headers["set-cookie"]?.[0];
  if (!cookie) throw new Error("Session response omitted its cookie");
  return { authorization: `Bearer ${session.body.token}`, cookie };
}

async function signArtifact(
  app: Express,
  authorization: string,
  action: OperatorActionDescriptor,
  privateKey = PRIVATE_KEY
): Promise<{ challengeId: string; message: string }> {
  const response = await request(app)
    .post("/v1/auth/challenges")
    .set("Authorization", authorization)
    .set("Origin", ORIGIN)
    .send({
      operatorPublicKey: privateKey === PRIVATE_KEY ? OPERATOR : OTHER_OPERATOR,
      purpose: "operator_action",
      action
    })
    .expect(201);
  return { challengeId: response.body.challengeId, message: response.body.message };
}

async function issueAgentToken(
  app: Express,
  authorization: string,
  revision: number,
  scopes: AgentTokenIssueSpec["scopes"]
): Promise<{ token: string; record: { id: string } }> {
  const spec: AgentTokenIssueSpec = {
    operatorPublicKey: OPERATOR,
    revision,
    agentName: "checkout-agent",
    scopes,
    allowedPayerPublicKeys: [PAYER],
    expiresAt: null
  };
  const action: OperatorActionDescriptor = {
    kind: "agent_token_issue",
    artifactHash: agentTokenIssueHash(spec),
    revision
  };
  const challenge = await signArtifact(app, authorization, action);
  const response = await request(app)
    .post("/v1/agent-tokens")
    .set("Authorization", authorization)
    .set("Origin", ORIGIN)
    .send({
      challengeId: challenge.challengeId,
      spec,
      signature: signMessage(challenge.message)
    })
    .expect(201);
  return response.body;
}

function policyRevision(revision: number, operatorPublicKey = OPERATOR): OperatorPolicy {
  const policy: OperatorPolicy = {
    policyId: `policy-${revision}`,
    operatorPublicKey,
    revision,
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
    signatureMessage: "",
    signature: "",
    policyHash: ""
  };
  policy.policyHash = operatorPolicyHash(policy);
  return policy;
}

function providerPin(revision: number): ProviderDecision {
  const decision: ProviderDecision = {
    decisionId: `provider-${revision}`,
    kind: "pin",
    operatorPublicKey: OPERATOR,
    revision,
    origin: "https://tab402.fly.dev",
    payee: PAYEE,
    asset: ASSET,
    network: "casper:casper-test",
    resourcePathPrefix: "/v1/",
    perCallCeiling: "1000",
    expiresAt: "2026-07-16T21:00:00.000Z",
    promptedByCheckId: "check-review",
    signatureMessage: "",
    signature: "",
    decisionHash: ""
  };
  decision.decisionHash = providerDecisionHash(decision);
  return decision;
}

function policyAction(policy: OperatorPolicy): OperatorActionDescriptor {
  return { kind: "policy_revision", artifactHash: policy.policyHash, revision: policy.revision };
}

function providerAction(decision: ProviderDecision): OperatorActionDescriptor {
  return {
    kind: "provider_decision",
    artifactHash: decision.decisionHash,
    revision: decision.revision
  };
}

function signMessage(message: string, privateKey = PRIVATE_KEY): string {
  const bytes = new TextEncoder().encode(`Casper Message:\n${message}`);
  return Buffer.from(ed25519.sign(bytes, privateKey)).toString("hex");
}
