import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { describe, expect, it } from "vitest";
import {
  authorizationDigest,
  buildAuthorizationIntent,
  transferWithAuthorizationDigest,
  verifyAuthorizationSignature,
  type PaymentTerms
} from "../../src/payment/index.js";

const terms: PaymentTerms = {
  x402Version: 2,
  acceptanceIndex: 0,
  scheme: "exact",
  network: "casper:casper-test",
  asset: "9".repeat(64),
  amount: "10000",
  payTo: `00${"8".repeat(64)}`,
  maxTimeoutSeconds: 300,
  extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "CSPR" },
  resource: { url: "https://agentpay.example/reports/buy/1", description: "Report", mimeType: "application/json" },
  resourceComparison: { sameHost: true, sameScheme: true, samePath: true },
  requirementHash: "a".repeat(64)
};

describe("x402 authorization binding", () => {
  it("reproduces the casper-x402 cross-language digest vector", () => {
    expect(
      transferWithAuthorizationDigest({
        tokenName: "TestToken",
        tokenVersion: "1",
        network: "casper-test",
        assetPackageHash: "aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
        from: "01aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
        to: "00aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
        value: "1000000",
        validAfter: "1700000000",
        validBefore: "1700001000",
        nonce: "aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788"
      })
    ).toBe("f49af32a160ef6078d23bd28c15e0e8d6d29e58f4cb88ed8582e958dfa07533b");
  });

  it("builds a complete unsigned intent from normalized terms", () => {
    const privateKey = new Uint8Array(32).fill(3);
    const payerPublicKey = `01${Buffer.from(ed25519.getPublicKey(privateKey)).toString("hex")}`;

    const intent = buildAuthorizationIntent({
      terms,
      payerPublicKey,
      nowEpochSeconds: 1_700_000_000,
      nonce: "11".repeat(32)
    });

    expect(intent).toMatchObject({
      payerPublicKey,
      to: terms.payTo,
      amount: terms.amount,
      validAfter: "1699999995",
      validBefore: "1700000295",
      nonce: "11".repeat(32),
      network: terms.network,
      asset: terms.asset,
      tokenName: terms.extra.name,
      tokenVersion: terms.extra.version
    });
    expect(intent.from).toMatch(/^00[0-9a-f]{64}$/);
    expect(intent.digest).toBe(authorizationDigest(intent));
  });

  it("verifies tagged Ed25519 and secp256k1 authorization signatures", () => {
    const edPrivate = new Uint8Array(32).fill(4);
    const edIntent = buildAuthorizationIntent({
      terms,
      payerPublicKey: `01${Buffer.from(ed25519.getPublicKey(edPrivate)).toString("hex")}`,
      nowEpochSeconds: 1_700_000_000,
      nonce: "22".repeat(32)
    });
    const edSignature = `01${Buffer.from(ed25519.sign(Buffer.from(edIntent.digest, "hex"), edPrivate)).toString("hex")}`;
    expect(verifyAuthorizationSignature(edIntent, edSignature)).toBe(true);

    const secpPrivate = new Uint8Array(32).fill(5);
    const secpIntent = buildAuthorizationIntent({
      terms,
      payerPublicKey: `02${Buffer.from(secp256k1.getPublicKey(secpPrivate, true)).toString("hex")}`,
      nowEpochSeconds: 1_700_000_000,
      nonce: "33".repeat(32)
    });
    const digest = Buffer.from(secpIntent.digest, "hex");
    const secpSignature = `02${Buffer.from(secp256k1.sign(sha256(digest), secpPrivate).toCompactRawBytes()).toString("hex")}`;
    expect(verifyAuthorizationSignature(secpIntent, secpSignature)).toBe(true);
    expect(
      verifyAuthorizationSignature({ ...secpIntent, digest: "f".repeat(64) }, secpSignature)
    ).toBe(false);
  });

  it.each([
    ["from", { from: `00${"7".repeat(64)}` }],
    ["to", { to: `00${"6".repeat(64)}` }],
    ["amount", { amount: "10001" }],
    ["validAfter", { validAfter: "1699999996" }],
    ["validBefore", { validBefore: "1700000296" }],
    ["nonce", { nonce: "44".repeat(32) }],
    ["asset", { asset: "5".repeat(64) }],
    ["network", { network: "casper:casper-test-other" }],
    ["tokenName", { tokenName: "Other" }],
    ["tokenVersion", { tokenVersion: "2" }]
  ])("changes the digest when %s changes", (_field, change) => {
    const privateKey = new Uint8Array(32).fill(6);
    const intent = buildAuthorizationIntent({
      terms,
      payerPublicKey: `01${Buffer.from(ed25519.getPublicKey(privateKey)).toString("hex")}`,
      nowEpochSeconds: 1_700_000_000,
      nonce: "55".repeat(32)
    });
    const changed = { ...intent, ...change } as typeof intent;

    expect(authorizationDigest(changed)).not.toBe(intent.digest);
  });

  it("keeps clock skew inside the negotiated authorization window", () => {
    const privateKey = new Uint8Array(32).fill(7);
    const intent = buildAuthorizationIntent({
      terms: { ...terms, maxTimeoutSeconds: 1 },
      payerPublicKey: `01${Buffer.from(ed25519.getPublicKey(privateKey)).toString("hex")}`,
      nowEpochSeconds: 1_700_000_000,
      nonce: "66".repeat(32)
    });

    expect(intent.validAfter).toBe("1700000000");
    expect(intent.validBefore).toBe("1700000001");
    expect(Number(intent.validBefore) - Number(intent.validAfter)).toBe(1);
  });
});
