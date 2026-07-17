import { describe, expect, it, vi } from "vitest";
import type { PaymentTerms } from "../src/audit/api";
import { createPaymentDraft } from "../src/audit/paymentDraft";

const PUBLIC_KEY = `01${"a".repeat(64)}`;

describe("browser payment preparation", () => {
  it("builds the exact short-lived authorization draft from the checked charge", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });

    const draft = createPaymentDraft({
      terms: paymentTerms(),
      payerPublicKey: PUBLIC_KEY,
      nowEpochSeconds: 1_784_250_000,
      webCrypto: { getRandomValues } as unknown as Crypto
    });

    expect(draft).toEqual({
      payerPublicKey: PUBLIC_KEY,
      from: "006320ec6f164c6bfa1fd3208deb2b797dcf0177fd1de32a8a1597c29b42f73b1b",
      to: `00${"8".repeat(64)}`,
      amount: "10000",
      validAfter: "1784249995",
      validBefore: "1784250295",
      nonce: "ab".repeat(32),
      network: "casper:casper-test",
      asset: "9".repeat(64),
      tokenName: "Cep18x402",
      tokenVersion: "1",
      digest: "b194a6bb3f8de126b497b8ae56233bf68b811a399da2744e04be899cb477b16b"
    });
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("fails closed when secure browser randomness is unavailable", () => {
    expect(() => createPaymentDraft({
      terms: paymentTerms(),
      payerPublicKey: PUBLIC_KEY,
      nowEpochSeconds: 1_784_250_000,
      webCrypto: null
    })).toThrow(/Secure browser randomness is unavailable/);
  });
});

function paymentTerms(): PaymentTerms {
  return {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "9".repeat(64),
    amount: "10000",
    payTo: `00${"8".repeat(64)}`,
    maxTimeoutSeconds: 300,
    extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "X402" },
    x402Version: 2,
    acceptanceIndex: 0,
    resource: { url: "https://svc.example/pay", description: "paid", mimeType: "application/json" },
    resourceComparison: { sameHost: true, sameScheme: true, samePath: true },
    requirementHash: "c".repeat(64)
  };
}
