import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  artifactHash,
  normalizeOriginalRequest,
  normalizePaymentRequired
} from "@agent-pay/core";
import {
  checkedX402Call,
  createCasperSigner,
  PaymentAuditError,
  type AgentPayApi,
  type CheckPaymentInput
} from "../src/index.js";

const NOW = "2026-07-15T21:00:00.000Z";
const TRANSACTION_HASH = "2".repeat(64);
const PAYMENT_REQUIRED = {
  x402Version: 2,
  resource: {
    url: "https://service.example/v1/generate",
    description: "Generate a response",
    mimeType: "application/json"
  },
  accepts: [{
    scheme: "exact",
    network: "casper:casper-test",
    asset: "5".repeat(64),
    amount: "100",
    payTo: `00${"6".repeat(64)}`,
    maxTimeoutSeconds: 300,
    extra: { name: "Casper X402 Token", version: "1", decimals: "9", symbol: "X402" }
  }]
};

describe("checkedX402Call", () => {
  it("calls the signer exactly once only after PAY and verifies the response receipt", async () => {
    const baseSigner = createCasperSigner("ed25519", new Uint8Array(32).fill(7));
    const signer = {
      ...baseSigner,
      privateKeyMaterial: "-----BEGIN PRIVATE KEY-----DO_NOT_SEND",
      sign: vi.fn(baseSigner.sign)
    };
    const api = paymentApi("pay");
    const requests: Array<{ headers: Headers; body: string; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined }> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? init.body : "";
      requests.push({ headers, body, redirect: init?.redirect, signal: init?.signal });
      if (requests.length === 1) {
        return new Response("payment required", {
          status: 402,
          headers: { "payment-required": Buffer.from(JSON.stringify(PAYMENT_REQUIRED)).toString("base64") }
        });
      }
      return new Response(JSON.stringify({ answer: "done" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "payment-response": Buffer.from(JSON.stringify({ success: true, transaction: TRANSACTION_HASH })).toString("base64")
        }
      });
    });

    const result = await checkedX402Call({
      url: "https://service.example/v1/generate",
      method: "POST",
      body: { prompt: "hello" },
      signer,
      api,
      fetchImpl,
      now: () => new Date(NOW),
      nonce: new Uint8Array(32).fill(9)
    });

    expect(result.settlement.proof.verdict).toBe("match");
    expect(result.receipt).toMatchObject({ checkId: "check-1" });
    expect(await result.response.json()).toMatchObject({ answer: "done" });
    expect(signer.sign).toHaveBeenCalledTimes(1);
    expect(requests[0].headers.has("payment-signature")).toBe(false);
    expect(requests[1].headers.get("payment-signature")).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(requests.every((request) => request.redirect === "error")).toBe(true);
    expect(requests.every((request) => request.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.stringify(api.check.mock.calls)).not.toContain("DO_NOT_SEND");
    expect(JSON.stringify(api.check.mock.calls)).not.toContain("privateKeyMaterial");
    expect(api.observe).toHaveBeenCalledWith("check-1", expect.objectContaining({
      status: 200,
      bodyHash: createHash("sha256").update(JSON.stringify({ answer: "done" })).digest("hex")
    }));
  });

  it.each(["review", "block"] as const)("does not sign or send payment when AgentPay returns %s", async (verdict) => {
    const baseSigner = createCasperSigner("ed25519", new Uint8Array(32).fill(7));
    const signer = { ...baseSigner, sign: vi.fn(baseSigner.sign) };
    const api = paymentApi(verdict);
    const fetchImpl = vi.fn(async () => new Response("payment required", {
      status: 402,
      headers: { "payment-required": Buffer.from(JSON.stringify(PAYMENT_REQUIRED)).toString("base64") }
    }));

    await expect(checkedX402Call({
      url: "https://service.example/v1/generate",
      method: "POST",
      body: { prompt: "hello" },
      signer,
      api,
      fetchImpl,
      now: () => new Date(NOW),
      nonce: new Uint8Array(32).fill(9)
    })).rejects.toMatchObject<Partial<PaymentAuditError>>({ verdict });

    expect(signer.sign).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not sign when the API changes the approved authorization digest", async () => {
    const baseSigner = createCasperSigner("ed25519", new Uint8Array(32).fill(7));
    const signer = { ...baseSigner, sign: vi.fn(baseSigner.sign) };
    const api = paymentApi("pay", true);

    await expect(checkedX402Call({
      url: "https://service.example/v1/generate",
      method: "POST",
      body: { prompt: "hello" },
      signer,
      api,
      fetchImpl: async () => new Response("payment required", {
        status: 402,
        headers: { "payment-required": Buffer.from(JSON.stringify(PAYMENT_REQUIRED)).toString("base64") }
      }),
      now: () => new Date(NOW),
      nonce: new Uint8Array(32).fill(9)
    })).rejects.toThrow(/authorization digest/i);

    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("cancels a paid response as soon as it exceeds the configured body limit", async () => {
    const signer = createCasperSigner("ed25519", new Uint8Array(32).fill(7));
    const api = paymentApi("pay");
    let requestCount = 0;
    let cancelled = false;
    const fetchImpl = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response("payment required", {
          status: 402,
          headers: { "payment-required": Buffer.from(JSON.stringify(PAYMENT_REQUIRED)).toString("base64") }
        });
      }
      let pullCount = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount += 1;
          controller.enqueue(new Uint8Array(4).fill(pullCount));
          if (pullCount === 3) controller.close();
        },
        cancel() {
          cancelled = true;
        }
      });
      return new Response(body, {
        status: 200,
        headers: { "payment-response": JSON.stringify({ transactionHash: TRANSACTION_HASH }) }
      });
    });

    await expect(checkedX402Call({
      url: "https://service.example/v1/generate",
      signer,
      api,
      fetchImpl,
      now: () => new Date(NOW),
      nonce: new Uint8Array(32).fill(9),
      maxResponseBytes: 5
    })).rejects.toThrow(/body limit/i);

    expect(cancelled).toBe(true);
    expect(api.verifySettlement).not.toHaveBeenCalled();
    expect(api.observe).not.toHaveBeenCalled();
  });
});

function paymentApi(verdict: "pay" | "review" | "block", alterDigest = false) {
  const check = vi.fn(async (input: CheckPaymentInput) => {
    const request = normalizeOriginalRequest(input.request);
    const normalized = normalizePaymentRequired(input.paymentRequired, request);
    if (!normalized.ok) throw new Error("Test requirement did not normalize");
    const authorization = alterDigest && input.authorization
      ? { ...input.authorization, digest: "f".repeat(64) }
      : input.authorization;
    const decisionContent = {
      checkId: "check-1",
      verdict,
      basis: verdict === "pay" ? "operator_pinned" : null,
      reasons: verdict === "pay" ? [] : [{ code: "provider_unapproved" }],
      advisories: [],
      policyHash: verdict === "pay" ? "a".repeat(64) : null,
      authorizationDigest: authorization?.digest ?? null,
      reservation: verdict === "pay" ? { amount: normalized.terms.amount, expiresAt: "2026-07-15T21:05:00.000Z" } : null,
      decidedAt: NOW
    };
    return {
      created: true,
      check: {
        id: "check-1",
        request,
        terms: normalized.terms,
        authorization,
        decision: { ...decisionContent, decisionHash: artifactHash(decisionContent) },
        status: verdict === "pay" ? "reserved" : verdict
      }
    };
  });
  return {
    check,
    verifySettlement: vi.fn(async () => ({
      created: true,
      check: { id: "check-1", status: "settled" },
      proof: { verdict: "match", transactionHash: TRANSACTION_HASH },
      receipt: null
    })),
    observe: vi.fn(async (checkId: string) => ({
      created: true,
      observation: { checkId },
      receipt: { receiptId: "receipt-1", checkId }
    })),
    getReceipt: vi.fn()
  } satisfies AgentPayApi & { check: ReturnType<typeof vi.fn> };
}
