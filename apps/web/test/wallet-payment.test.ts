import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationIntent,
  normalizeOriginalRequest,
  normalizePaymentRequired
} from "../../../packages/agent-pay-core/src/payment/index";
import type { PaymentCheck, ProbeInput } from "../src/audit/api";
import { submitCheckedWalletPayment } from "../src/audit/walletPayment";

const PRIVATE_KEY = new Uint8Array(32).fill(23);
const PUBLIC_KEY = `01${hex(ed25519.getPublicKey(PRIVATE_KEY))}`;
const URL = "https://service.example/paid-report";
const BODY = {};
const BODY_BYTES = new TextEncoder().encode(JSON.stringify(BODY));
const TRANSACTION_HASH = "e".repeat(64);

describe("checked browser wallet payment", () => {
  it("submits the exact checked request and returns a hashed response observation", async () => {
    const fixture = paymentFixture();
    const signature = sign(fixture.check.authorization!.digest);
    const signer = vi.fn(async () => signature);
    const responseBody = new TextEncoder().encode(JSON.stringify({ report: "ready" }));
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(URL);
      expect(init?.method).toBe("POST");
      expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(JSON.stringify(BODY));
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");

      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.get("content-type")).toBe("application/json");
      const payload = JSON.parse(atob(headers.get("payment-signature") ?? ""));
      expect(payload).toEqual({
        x402Version: 2,
        accepted: fixture.paymentRequired.accepts[0],
        resource: fixture.paymentRequired.resource,
        payload: {
          signature,
          publicKey: PUBLIC_KEY,
          authorization: {
            from: fixture.check.authorization!.from,
            to: fixture.check.authorization!.to,
            value: fixture.check.authorization!.amount,
            validAfter: fixture.check.authorization!.validAfter,
            validBefore: fixture.check.authorization!.validBefore,
            nonce: fixture.check.authorization!.nonce
          }
        }
      });

      return new Response(responseBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "payment-response": btoa(JSON.stringify({ success: true, transaction: TRANSACTION_HASH }))
        }
      });
    });

    const result = await submitCheckedWalletPayment({
      check: fixture.check,
      paymentRequired: fixture.paymentRequired,
      probeInput: fixture.probeInput,
      signAuthorization: signer,
      fetchImpl,
      now: () => new Date("2026-07-17T15:00:00.000Z")
    });

    expect(signer).toHaveBeenCalledWith(fixture.check.authorization);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.transactionHash).toBe(TRANSACTION_HASH);
    expect(result.observation).toEqual({
      observerVersion: "agentpay-web/0.1.0",
      status: 200,
      contentType: "application/json",
      bodyBytes: responseBody.byteLength,
      bodyHash: sha256(responseBody),
      observedAt: "2026-07-17T15:00:00.000Z"
    });
  });

  it("refuses a changed request body before asking the wallet to sign", async () => {
    const fixture = paymentFixture();
    const signer = vi.fn();
    const fetchImpl = vi.fn();

    await expect(
      submitCheckedWalletPayment({
        check: fixture.check,
        paymentRequired: fixture.paymentRequired,
        probeInput: { ...fixture.probeInput, body: { changed: true } },
        signAuthorization: signer,
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "payment_request_changed" });
    expect(signer).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a different PAYMENT-REQUIRED challenge before signing", async () => {
    const fixture = paymentFixture();
    const signer = vi.fn();
    const fetchImpl = vi.fn();
    const changed = structuredClone(fixture.paymentRequired);
    changed.accepts[0].amount = "101";

    await expect(
      submitCheckedWalletPayment({
        check: fixture.check,
        paymentRequired: changed,
        probeInput: fixture.probeInput,
        signAuthorization: signer,
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "payment_charge_changed" });
    expect(signer).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function paymentFixture(): {
  check: PaymentCheck;
  paymentRequired: ReturnType<typeof paymentRequired>;
  probeInput: ProbeInput;
} {
  const request = normalizeOriginalRequest({
    method: "POST",
    url: URL,
    bodyHash: sha256(BODY_BYTES),
    bodyBytes: BODY_BYTES.byteLength,
    capturedAt: "2026-07-17T14:59:00.000Z",
    adapterVersion: "agentpay-probe/1.0"
  });
  const challenge = paymentRequired();
  const normalized = normalizePaymentRequired(challenge, request);
  if (!normalized.ok) throw new Error("invalid test challenge");
  const authorization = buildAuthorizationIntent({
    terms: normalized.terms,
    payerPublicKey: PUBLIC_KEY,
    nowEpochSeconds: 1_784_300_340,
    nonce: "11".repeat(32)
  });
  const check = {
    id: "check-wallet-1",
    request,
    terms: normalized.terms,
    authorization,
    decision: {
      checkId: "check-wallet-1",
      verdict: "pay",
      basis: "rules",
      reasons: [],
      advisories: [],
      policyHash: "b".repeat(64),
      authorizationDigest: authorization.digest,
      reservation: null,
      decidedAt: "2026-07-17T14:59:01.000Z",
      decisionHash: "c".repeat(64)
    },
    status: "reserved"
  } as PaymentCheck;
  return {
    check,
    paymentRequired: challenge,
    probeInput: { url: URL, method: "POST", body: BODY }
  };
}

function paymentRequired() {
  return {
    x402Version: 2,
    resource: {
      url: URL,
      description: "Paid report",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: "exact",
        network: "casper:casper-test",
        asset: "9".repeat(64),
        amount: "100",
        payTo: `00${"8".repeat(64)}`,
        maxTimeoutSeconds: 300,
        extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "TEST" }
      }
    ]
  };
}

function sign(digest: string): string {
  return `01${hex(ed25519.sign(hexBytes(digest), PRIVATE_KEY))}`;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
