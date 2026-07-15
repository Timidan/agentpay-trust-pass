import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it } from "vitest";
import {
  AuditorAuth,
  AuthError,
  hashBearerToken,
  type OperatorActionDescriptor
} from "../../src/auditor/auth.js";
import { openSqliteRepository } from "../../src/auditor/sqliteRepository.js";
import type { AgentTokenRecord } from "../../src/auditor/repository.js";

const ORIGIN = "https://agentpay.example";
const NOW = "2026-07-15T21:00:00.000Z";
const PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const OTHER_PRIVATE_KEY = new Uint8Array(32).fill(9);
const PUBLIC_KEY = `01${Buffer.from(ed25519.getPublicKey(PRIVATE_KEY)).toString("hex")}`;
const OTHER_PUBLIC_KEY = `01${Buffer.from(ed25519.getPublicKey(OTHER_PRIVATE_KEY)).toString("hex")}`;

describe("AuditorAuth", () => {
  it("creates and authenticates a one-hour operator session", () => {
    const context = createContext();
    const issued = context.auth.issueChallenge({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      purpose: "session"
    });

    const created = context.auth.createSession({
      challengeId: issued.challenge.id,
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      signature: signMessage(issued.message)
    });

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.session).toMatchObject({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      expiresAt: "2026-07-15T22:00:00.000Z",
      revokedAt: null
    });
    expect(context.auth.authenticateCredential(created.token)).toMatchObject({
      kind: "operator",
      session: { id: created.session.id, operatorPublicKey: PUBLIC_KEY }
    });
    context.close();
  });

  it("rejects challenge issuance for an unconfigured origin", () => {
    const context = createContext();

    expect(() =>
      context.auth.issueChallenge({
        operatorPublicKey: PUBLIC_KEY,
        origin: "https://attacker.example",
        purpose: "session"
      })
    ).toThrowError(expect.objectContaining({ code: "origin_mismatch", status: 403 }));
    context.close();
  });

  it("rejects expired challenges without consuming a signature", () => {
    const context = createContext();
    const issued = context.auth.issueChallenge({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      purpose: "session"
    });
    context.setNow("2026-07-15T21:05:01.000Z");

    expect(() =>
      context.auth.createSession({
        challengeId: issued.challenge.id,
        operatorPublicKey: PUBLIC_KEY,
        origin: ORIGIN,
        signature: signMessage(issued.message)
      })
    ).toThrowError(expect.objectContaining({ code: "challenge_expired", status: 401 }));
    context.close();
  });

  it("rejects the wrong public key and signatures over altered challenge text", () => {
    const context = createContext();
    const issued = context.auth.issueChallenge({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      purpose: "session"
    });

    expect(() =>
      context.auth.createSession({
        challengeId: issued.challenge.id,
        operatorPublicKey: OTHER_PUBLIC_KEY,
        origin: ORIGIN,
        signature: signMessage(issued.message, OTHER_PRIVATE_KEY)
      })
    ).toThrowError(expect.objectContaining({ code: "challenge_operator_mismatch", status: 401 }));
    expect(() =>
      context.auth.createSession({
        challengeId: issued.challenge.id,
        operatorPublicKey: PUBLIC_KEY,
        origin: ORIGIN,
        signature: signMessage(`${issued.message} altered`)
      })
    ).toThrowError(expect.objectContaining({ code: "invalid_signature", status: 401 }));
    context.close();
  });

  it("consumes a valid session challenge exactly once", () => {
    const context = createContext();
    const issued = context.auth.issueChallenge({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      purpose: "session"
    });
    const input = {
      challengeId: issued.challenge.id,
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      signature: signMessage(issued.message)
    };

    expect(context.auth.createSession(input).session.operatorPublicKey).toBe(PUBLIC_KEY);
    expect(() => context.auth.createSession(input)).toThrowError(
      expect.objectContaining({ code: "challenge_replayed", status: 409 })
    );
    context.close();
  });

  it("binds operator-action challenges to the exact canonical descriptor", () => {
    const context = createContext();
    const action: OperatorActionDescriptor = {
      kind: "policy_revision",
      artifactHash: "a".repeat(64),
      revision: 1
    };
    const issued = context.auth.issueChallenge({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      purpose: "operator_action",
      action
    });
    const signature = signMessage(issued.message);

    expect(() =>
      context.auth.verifyOperatorAction({
        challengeId: issued.challenge.id,
        operatorPublicKey: PUBLIC_KEY,
        origin: ORIGIN,
        action: { ...action, artifactHash: "b".repeat(64) },
        signature
      })
    ).toThrowError(expect.objectContaining({ code: "signed_action_mismatch", status: 401 }));
    expect(
      context.auth.verifyOperatorAction({
        challengeId: issued.challenge.id,
        operatorPublicKey: PUBLIC_KEY,
        origin: ORIGIN,
        action,
        signature
      })
    ).toBeUndefined();
    expect(() =>
      context.auth.verifyOperatorAction({
        challengeId: issued.challenge.id,
        operatorPublicKey: PUBLIC_KEY,
        origin: ORIGIN,
        action,
        signature
      })
    ).toThrowError(expect.objectContaining({ code: "challenge_replayed", status: 409 }));
    context.close();
  });

  it("expires sessions and rejects revoked credentials", () => {
    const context = createContext();
    const issued = context.auth.issueChallenge({
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      purpose: "session"
    });
    const created = context.auth.createSession({
      challengeId: issued.challenge.id,
      operatorPublicKey: PUBLIC_KEY,
      origin: ORIGIN,
      signature: signMessage(issued.message)
    });
    context.setNow("2026-07-15T22:00:01.000Z");

    expect(() => context.auth.authenticateCredential(created.token)).toThrowError(
      expect.objectContaining({ code: "session_expired", status: 401 })
    );
    context.close();
  });

  it("enforces agent scopes, payer bindings, expiry, and revocation", () => {
    const context = createContext();
    const rawToken = Buffer.alloc(32, 7).toString("base64url");
    const payer = `01${"3".repeat(64)}`;
    const record: AgentTokenRecord = {
      id: "agent-token-1",
      operatorPublicKey: PUBLIC_KEY,
      agentName: "checkout-agent",
      tokenHash: hashBearerToken(rawToken),
      scopes: ["checks:write"],
      allowedPayerPublicKeys: [payer],
      revision: 1,
      actionHash: "c".repeat(64),
      signature: `01${"d".repeat(128)}`,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null
    };
    context.repository.saveAgentToken(record);

    expect(context.auth.authorizeAgent(rawToken, "checks:write", payer)).toEqual(record);
    expect(() => context.auth.authorizeAgent(rawToken, "settlements:write", payer)).toThrowError(
      expect.objectContaining({ code: "agent_scope_denied", status: 403 })
    );
    expect(() => context.auth.authorizeAgent(rawToken, "checks:write", OTHER_PUBLIC_KEY)).toThrowError(
      expect.objectContaining({ code: "payer_not_allowed", status: 403 })
    );

    context.repository.revokeAgentToken({
      tokenId: record.id,
      operatorPublicKey: PUBLIC_KEY,
      revision: 2,
      actionHash: "e".repeat(64),
      signature: `01${"f".repeat(128)}`,
      revokedAt: NOW
    });
    expect(() => context.auth.authorizeAgent(rawToken, "checks:write", payer)).toThrowError(
      expect.objectContaining({ code: "agent_token_revoked", status: 401 })
    );

    const expiredRawToken = Buffer.alloc(32, 8).toString("base64url");
    context.repository.saveAgentToken({
      ...record,
      id: "agent-token-expired",
      tokenHash: hashBearerToken(expiredRawToken),
      revision: 3,
      actionHash: "1".repeat(64),
      signature: `01${"2".repeat(128)}`,
      expiresAt: "2026-07-15T20:59:59.000Z"
    });
    expect(() => context.auth.authorizeAgent(expiredRawToken, "checks:write", payer)).toThrowError(
      expect.objectContaining({ code: "agent_token_expired", status: 401 })
    );
    context.close();
  });

  it("uses constant-shape authentication errors", () => {
    const error = new AuthError("invalid_credentials", "Credential is invalid", 401);

    expect(error.toBody()).toEqual({
      code: "invalid_credentials",
      message: "Credential is invalid",
      retryable: false,
      field: null,
      expected: null,
      received: null
    });
  });
});

function createContext() {
  let now = new Date(NOW);
  const repository = openSqliteRepository(":memory:", { now: () => now });
  const auth = new AuditorAuth({
    repository,
    publicOrigin: ORIGIN,
    now: () => now
  });
  return {
    repository,
    auth,
    setNow(value: string) {
      now = new Date(value);
    },
    close() {
      repository.close();
    }
  };
}

function signMessage(message: string, privateKey = PRIVATE_KEY): string {
  const bytes = new TextEncoder().encode(`Casper Message:\n${message}`);
  return Buffer.from(ed25519.sign(bytes, privateKey)).toString("hex");
}
