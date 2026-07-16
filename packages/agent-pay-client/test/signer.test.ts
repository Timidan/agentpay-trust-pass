import { describe, expect, it } from "vitest";
import {
  buildX402PaymentSignature,
  createCasperSigner,
  transferWithAuthorizationDigest,
  type PaymentRequirement,
  type PaymentResource
} from "../src/index.js";

describe("local Casper signer compatibility", () => {
  it("preserves the casper-x402 Go digest vector", () => {
    const digest = transferWithAuthorizationDigest({
      tokenName: "TestToken",
      tokenVersion: "1",
      network: "casper-test",
      assetPackageHash: "aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
      from: "01aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
      to: "00aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
      value: "1000000",
      validAfter: 1_700_000_000,
      validBefore: 1_700_001_000,
      nonceHex: "aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788"
    });

    expect(Buffer.from(digest).toString("hex")).toBe(
      "f49af32a160ef6078d23bd28c15e0e8d6d29e58f4cb88ed8582e958dfa07533b"
    );
  });

  it("preserves the fixed secp256k1 identity, digest, and signature bytes", () => {
    const signer = createCasperSigner("secp256k1", new Uint8Array(32).fill(1));
    const requirement: PaymentRequirement = {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
    };
    const resource: PaymentResource = {
      url: "https://service.example/pay",
      description: "test",
      mimeType: "application/json"
    };

    const built = buildX402PaymentSignature({
      requirement,
      resource,
      signer,
      now: 1_700_000_000,
      nonce: new Uint8Array(32).fill(0x11)
    });
    const payload = built.paymentPayload as {
      payload: { signature: string };
    };

    expect(signer.publicKeyHex).toBe("02031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f");
    expect(signer.accountAddress).toBe("0028bbf7efd9be97339596ef441ff27d1e32195e90ddb17253c13951d23e5137a5");
    expect(built.authorization).toMatchObject({
      validAfter: "1699999995",
      validBefore: "1700000295"
    });
    expect(built.digestHex).toBe("652ee74b54ab4e8835f43bbcfbffe403c854e206cce0194dbde88b0407831ad9");
    expect(payload.payload.signature).toBe(
      "028f48dd0aced7dd865444d1d597bc21ab0c7d26fff264487b161e838d9bc888da3c71679ef35d678d7c42ce086a6106fb46bdbd8342d1ae01a8757ffe87f456c2"
    );
  });
});
