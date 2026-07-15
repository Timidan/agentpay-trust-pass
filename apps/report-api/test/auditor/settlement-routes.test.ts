import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_TOKEN,
  FINALIZED_TRANSACTION_RESULT,
  TRANSACTION_HASH,
  createPayCheck,
  createPaymentAuditContext,
  mismatchedTransactionResult,
  pendingTransactionResult,
  type PaymentAuditContext
} from "./payment-audit-fixture.js";

let context: PaymentAuditContext | null = null;

afterEach(() => {
  context?.repository.close();
  context = null;
});

describe("settlement verification routes", () => {
  it("matches the captured Tab402 transaction and consumes the reservation", async () => {
    context = createPaymentAuditContext();
    const checkId = await createPayCheck(context.app);

    const response = await verifySettlement(context, checkId).expect(200);

    expect(response.body).toMatchObject({
      proof: { checkId, transactionHash: TRANSACTION_HASH, verdict: "match" },
      check: { id: checkId, status: "settled" },
      receipt: null
    });
    expect(context.repository.getReservation(checkId)?.status).toBe("consumed");
    expect(context.repository.spentTotal(response.body.check.operatorPublicKey, response.body.check.terms.asset, "2026-07-09"))
      .toBe("100000000");
  });

  it("quarantines a reservation when any finalized settlement field differs", async () => {
    context = createPaymentAuditContext(mismatchedTransactionResult());
    const checkId = await createPayCheck(context.app);

    const response = await verifySettlement(context, checkId).expect(200);

    expect(response.body.proof.verdict).toBe("mismatch");
    expect(response.body.check.status).toBe("settlement_mismatch");
    expect(context.repository.getReservation(checkId)?.status).toBe("quarantined");
  });

  it("retains the reservation while pending and can later finalize the same transaction", async () => {
    context = createPaymentAuditContext(pendingTransactionResult());
    const checkId = await createPayCheck(context.app);

    const pending = await verifySettlement(context, checkId).expect(200);
    expect(pending.body.proof.verdict).toBe("pending");
    expect(context.repository.getReservation(checkId)?.status).toBe("active");

    context.setTransactionResult(FINALIZED_TRANSACTION_RESULT);
    const matched = await verifySettlement(context, checkId).expect(200);
    expect(matched.body.proof.verdict).toBe("match");
    expect(context.repository.getReservation(checkId)?.status).toBe("consumed");
  });

  it("records a retryable RPC failure without changing the reservation", async () => {
    context = createPaymentAuditContext(new Error("test RPC outage"));
    const checkId = await createPayCheck(context.app);

    const response = await verifySettlement(context, checkId).expect(200);

    expect(response.body.proof.verdict).toBe("unverifiable");
    expect(response.body.proof.reasons[0].code).toBe("settlement_rpc_unavailable");
    expect(response.body.check.status).toBe("settlement_unverifiable");
    expect(context.repository.getReservation(checkId)?.status).toBe("active");
  });

  it("rejects malformed hashes before contacting Casper and keeps terminal results immutable", async () => {
    context = createPaymentAuditContext();
    const checkId = await createPayCheck(context.app);

    const malformed = await request(context.app)
      .post(`/v1/checks/${checkId}/verify-settlement`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .send({ transactionHash: "not-a-hash" })
      .expect(400);
    expect(malformed.body.code).toBe("invalid_request");

    await verifySettlement(context, checkId).expect(200);
    const conflict = await request(context.app)
      .post(`/v1/checks/${checkId}/verify-settlement`)
      .set("Authorization", `Bearer ${AGENT_TOKEN}`)
      .send({ transactionHash: "f".repeat(64) })
      .expect(409);
    expect(conflict.body.code).toBe("settlement_conflict");
  });
});

function verifySettlement(active: PaymentAuditContext, checkId: string) {
  return request(active.app)
    .post(`/v1/checks/${checkId}/verify-settlement`)
    .set("Authorization", `Bearer ${AGENT_TOKEN}`)
    .send({ transactionHash: TRANSACTION_HASH });
}
