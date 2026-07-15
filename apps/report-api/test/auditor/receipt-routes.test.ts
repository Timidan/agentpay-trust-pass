import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_TOKEN,
  NOW,
  OPERATOR_SESSION_TOKEN,
  TRANSACTION_HASH,
  createPayCheck,
  createPaymentAuditContext,
  type PaymentAuditContext
} from "./payment-audit-fixture.js";

let context: PaymentAuditContext | null = null;

afterEach(() => {
  context?.repository.close();
  context = null;
});

describe("response observations and receipt routes", () => {
  it("creates one immutable receipt after MATCH and verifies it without authentication", async () => {
    context = createPaymentAuditContext();
    const checkId = await settledCheck(context);

    const observed = await observe(context, checkId).expect(201);

    expect(observed.body.observation).toMatchObject({
      checkId,
      status: 200,
      contentType: "audio/mpeg",
      bodyBytes: 42000
    });
    expect(observed.body.receipt).toMatchObject({
      schemaVersion: "agentpay-purchase/v1",
      checkId,
      settlement: { verdict: "match", transactionHash: TRANSACTION_HASH },
      anchor: { status: "off_chain_verified", transactionHash: null }
    });

    const receiptId = observed.body.receipt.receiptId as string;
    const fetched = await request(context.app)
      .get(`/v1/receipts/${receiptId}`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .expect(200);
    expect(fetched.body.receipt).toEqual(observed.body.receipt);

    const verified = await request(context.app)
      .post("/v1/receipts/verify")
      .send({ receipt: observed.body.receipt })
      .expect(200);
    expect(verified.body).toEqual({ verified: true, errors: [] });
  });

  it("is idempotent for the same observation and rejects conflicting metadata", async () => {
    context = createPaymentAuditContext();
    const checkId = await settledCheck(context);

    const first = await observe(context, checkId).expect(201);
    const replay = await observe(context, checkId).expect(200);
    expect(replay.body).toEqual({
      created: false,
      observation: first.body.observation,
      receipt: first.body.receipt
    });

    const conflict = await request(context.app)
      .post(`/v1/checks/${checkId}/response-observations`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .send({ ...observationBody(), status: 500 })
      .expect(409);
    expect(conflict.body.code).toBe("observation_conflict");
  });

  it("rejects response bodies, premature observations, and tampered receipts", async () => {
    context = createPaymentAuditContext();
    const checkId = await createPayCheck(context.app);

    const premature = await observe(context, checkId).expect(409);
    expect(premature.body.code).toBe("settlement_required");

    await request(context.app)
      .post(`/v1/checks/${checkId}/verify-settlement`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .send({ transactionHash: TRANSACTION_HASH })
      .expect(200);
    const bodyRejected = await request(context.app)
      .post(`/v1/checks/${checkId}/response-observations`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .send({ ...observationBody(), body: "secret response" })
      .expect(400);
    expect(bodyRejected.body.code).toBe("invalid_request");

    const observed = await observe(context, checkId).expect(201);
    const tampered = structuredClone(observed.body.receipt);
    tampered.response.bodyHash = "f".repeat(64);
    const verification = await request(context.app)
      .post("/v1/receipts/verify")
      .send({ receipt: tampered })
      .expect(200);
    expect(verification.body.verified).toBe(false);
    expect(verification.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "receipt_hash_mismatch" })])
    );
  });

  it("creates an expiring read-only link and revokes it without exposing the token hash", async () => {
    context = createPaymentAuditContext();
    const checkId = await settledCheck(context);
    const observed = await observe(context, checkId).expect(201);
    const receiptId = observed.body.receipt.receiptId as string;

    const created = await request(context.app)
      .post(`/v1/receipts/${receiptId}/shares`)
      .set("Authorization", `Bearer ${OPERATOR_SESSION_TOKEN}`)
      .send({ expiresAt: "2026-07-10T16:13:00.000Z" })
      .expect(201);
    expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.share).not.toHaveProperty("tokenHash");
    expect(created.body.url).toContain(encodeURIComponent(created.body.token));

    const shared = await request(context.app)
      .get(`/v1/receipts/${receiptId}`)
      .query({ share: created.body.token })
      .expect(200);
    expect(shared.body.receipt).toEqual(observed.body.receipt);

    await request(context.app)
      .delete(`/v1/receipts/${receiptId}/shares/${created.body.share.id}`)
      .set("Authorization", `Bearer ${OPERATOR_SESSION_TOKEN}`)
      .expect(204);
    await request(context.app)
      .get(`/v1/receipts/${receiptId}`)
      .query({ share: created.body.token })
      .expect(404);
  });
});

async function settledCheck(active: PaymentAuditContext): Promise<string> {
  const checkId = await createPayCheck(active.app);
  await request(active.app)
    .post(`/v1/checks/${checkId}/verify-settlement`)
    .set("Authorization", `Bearer ${AGENT_TOKEN}`)
    .send({ transactionHash: TRANSACTION_HASH })
    .expect(200);
  return checkId;
}

function observe(active: PaymentAuditContext, checkId: string) {
  return request(active.app)
    .post(`/v1/checks/${checkId}/response-observations`)
    .set("Authorization", `Bearer ${AGENT_TOKEN}`)
    .send(observationBody());
}

function observationBody() {
  return {
    observerVersion: "agent-pay-client/0.1.0",
    status: 200,
    contentType: "audio/mpeg",
    bodyBytes: 42_000,
    bodyHash: "8".repeat(64),
    observedAt: NOW
  };
}
