import { describe, expect, it, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  buildX402PaymentSignature,
  createCasperSigner,
  transferWithAuthorizationDigest,
  x402SpendPolicyFromEnv,
  type CasperSigner,
  type PaymentRequirement,
  type PaymentResource
} from "../x402-buyer";

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

describe("x402 buyer EIP-712 digest", () => {
  it("reproduces the casper-x402 facilitator's TransferWithAuthorization digest vector", () => {
    // Vector copied verbatim from casper-x402 hash_test.go (Go/JS cross-language parity).
    const digest = transferWithAuthorizationDigest({
      tokenName: "TestToken",
      tokenVersion: "1",
      network: "casper-test",
      assetPackageHash: "aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
      from: "01aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
      to: "00aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788",
      value: "1000000",
      validAfter: 1700000000,
      validBefore: 1700001000,
      nonceHex: "aabbccddeeff0011223344556677889900aabbccddeeff001122334455667788"
    });
    expect(Buffer.from(digest).toString("hex")).toBe(
      "f49af32a160ef6078d23bd28c15e0e8d6d29e58f4cb88ed8582e958dfa07533b"
    );
  });
});

describe("x402 buyer Casper signing", () => {
  const digest = sha256(new TextEncoder().encode("agentpay-x402-digest")); // any 32 bytes

  it("secp256k1: produces a 0x02-tagged signature that verifies under the Casper scheme", () => {
    const priv = secp256k1.utils.randomPrivateKey();
    const signer = createCasperSigner("secp256k1", priv);
    expect(signer.publicKeyHex.startsWith("02")).toBe(true);
    expect(signer.accountAddress).toMatch(/^00[0-9a-f]{64}$/);

    const sig = signer.sign(digest);
    expect(sig.length).toBe(65);
    expect(sig[0]).toBe(0x02);

    // Casper secp256k1 verify = ECDSA over sha256(message), pubkey = compressed (strip 02 tag).
    const pubCompressed = hexToBytes(signer.publicKeyHex.slice(2));
    const ok = secp256k1.verify(sig.slice(1), sha256(digest), pubCompressed, { lowS: true });
    expect(ok).toBe(true);
  });

  it("ed25519: produces a 0x01-tagged signature that verifies under the Casper scheme", () => {
    const priv = ed25519.utils.randomPrivateKey();
    const signer = createCasperSigner("ed25519", priv);
    expect(signer.publicKeyHex.startsWith("01")).toBe(true);

    const sig = signer.sign(digest);
    expect(sig.length).toBe(65);
    expect(sig[0]).toBe(0x01);

    // Casper ed25519 verify = ed25519 over the raw message, pubkey = 32 bytes (strip 01 tag).
    const pub = hexToBytes(signer.publicKeyHex.slice(2));
    expect(ed25519.verify(sig.slice(1), digest, pub)).toBe(true);
  });
});

describe("x402 buyer payment payload", () => {
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "9".repeat(64),
    amount: "10000",
    payTo: "00" + "8".repeat(64),
    maxTimeoutSeconds: 300,
    extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
  };
  const resource: PaymentResource = {
    url: "http://127.0.0.1:4021/reports/buy/agent-pay-live-1",
    description: "AgentPay live evidence report",
    mimeType: "application/json"
  };

  it("assembles a binding-compatible, facilitator-shaped, base64-decodable PAYMENT-SIGNATURE", () => {
    const signer = createCasperSigner("secp256k1", secp256k1.utils.randomPrivateKey());
    const built = buildX402PaymentSignature({
      requirement,
      resource,
      signer,
      now: 1_700_000_000,
      nonce: hexToBytes("11".repeat(32))
    });

    const decoded = JSON.parse(Buffer.from(built.header, "base64").toString("utf8"));
    // Report API quote binding reads these top-level fields.
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted).toEqual(requirement);
    expect(decoded.resource).toEqual(resource);
    // Facilitator reads the casper-x402 ExactCasperPayload under .payload.
    expect(decoded.payload.publicKey).toBe(signer.publicKeyHex);
    expect(decoded.payload.authorization).toMatchObject({
      from: signer.accountAddress,
      to: requirement.payTo,
      value: "10000",
      validAfter: String(1_700_000_000 - 5),
      validBefore: String(1_700_000_000 + 295),
      nonce: "11".repeat(32)
    });
    expect(decoded.payload.signature).toMatch(/^02[0-9a-f]{128}$/);

    // The signature must verify against the EIP-712 digest the facilitator recomputes.
    const sig = hexToBytes(decoded.payload.signature);
    const pubCompressed = hexToBytes(signer.publicKeyHex.slice(2));
    expect(
      secp256k1.verify(sig.slice(1), sha256(hexToBytes(built.digestHex)), pubCompressed, { lowS: true })
    ).toBe(true);
  });
});

describe("x402 buyer spend policy", () => {
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "9".repeat(64),
    amount: "10000",
    payTo: "00" + "8".repeat(64),
    maxTimeoutSeconds: 300,
    extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
  };
  const resource: PaymentResource = {
    url: "http://127.0.0.1:4021/reports/buy/agent-pay-live-1",
    description: "AgentPay live evidence report",
    mimeType: "application/json"
  };

  it("signs when the quoted payment is within local policy", () => {
    const signer = mockSigner();

    const built = buildX402PaymentSignature({
      requirement,
      resource,
      signer,
      policy: x402SpendPolicyFromEnv({
        AGENT_PAY_EXPECTED_PAYEE_ADDRESS: requirement.payTo,
        AGENT_PAY_EXPECTED_X402_ASSET: requirement.asset,
        AGENT_PAY_EXPECTED_NETWORK: requirement.network,
        AGENT_PAY_MAX_REPORT_AMOUNT: requirement.amount
      }),
      now: 1_700_000_000,
      nonce: hexToBytes("22".repeat(32))
    });

    expect(built.authorization.to).toBe(requirement.payTo);
    expect(signer.sign).toHaveBeenCalledOnce();
  });

  it("rejects and does not sign when the payee address mismatches policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement: { ...requirement, payTo: `00${"7".repeat(64)}` },
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_EXPECTED_PAYEE_ADDRESS: requirement.payTo
        })
      })
    ).toThrow(/payee address mismatch.*expected.*actual/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects and does not sign when the x402 asset mismatches policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement: { ...requirement, asset: "7".repeat(64) },
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_EXPECTED_X402_ASSET: requirement.asset
        })
      })
    ).toThrow(/asset mismatch.*expected.*actual/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects and does not sign when the network mismatches policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement: { ...requirement, network: "casper:casper" },
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_EXPECTED_NETWORK: requirement.network
        })
      })
    ).toThrow(/network mismatch.*expected.*actual/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects and does not sign when the quoted amount exceeds policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement,
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_MAX_REPORT_AMOUNT: "9999"
        })
      })
    ).toThrow(/amount exceeds.*expected <= 9999.*actual 10000/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });
});

function mockSigner(): CasperSigner & { sign: ReturnType<typeof vi.fn> } {
  return {
    algo: "secp256k1",
    publicKeyHex: `02${"1".repeat(66)}`,
    accountAddress: `00${"6".repeat(64)}`,
    sign: vi.fn(() => new Uint8Array(65).fill(2))
  };
}
