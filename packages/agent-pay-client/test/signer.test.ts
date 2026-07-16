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
    expect(built.digestHex).toBe("ad17765af57d2e3aa89095df8f2801c40eda675e18739406b04f90117c44dd23");
    expect(payload.payload.signature).toBe(
      "0265450de7efd345f29bc6da45b17f5e64e240e77b8d8fdd95b838c7d4a4844f7312383f3317d08175d3a1f35bb572b3d3c5be8b5c981344fa1e45aeb3015642c6"
    );
  });
});
