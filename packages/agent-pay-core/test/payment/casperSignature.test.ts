import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { describe, expect, it } from "vitest";
import {
  operatorActionMessage,
  publicKeyToAccountAddress,
  verifyCasperMessageSignature
} from "../../src/payment/index.js";

const encoder = new TextEncoder();

describe("Casper message signatures", () => {
  it("derives the account address used by the captured Tab402 transaction", () => {
    expect(
      publicKeyToAccountAddress("01aff8a88e9d562dad2befec259a8818371d6d092328e8490bb6fc9644041c7c03")
    ).toBe("00e27bfb95afa9b87a76e76d993928d8d4a1d119aea0f202cf4bf2cc036d534b28");
  });

  it("verifies CSPR.click-compatible Ed25519 message signatures", () => {
    const privateKey = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
    const publicKey = `01${Buffer.from(ed25519.getPublicKey(privateKey)).toString("hex")}`;
    const message = operatorActionMessage({ kind: "provider_pin", revision: 1, nonce: "11".repeat(32) });
    const bytes = encoder.encode(`Casper Message:\n${message}`);
    const signature = Buffer.from(ed25519.sign(bytes, privateKey)).toString("hex");

    expect(verifyCasperMessageSignature({ message, publicKeyHex: publicKey, signatureHex: signature })).toBe(true);
    expect(verifyCasperMessageSignature({ message: `${message}x`, publicKeyHex: publicKey, signatureHex: signature })).toBe(false);
  });

  it("verifies CSPR.click-compatible secp256k1 message signatures", () => {
    const privateKey = new Uint8Array(32).fill(7);
    const publicKey = `02${Buffer.from(secp256k1.getPublicKey(privateKey, true)).toString("hex")}`;
    const message = operatorActionMessage({ kind: "policy_revision", revision: 2, nonce: "22".repeat(32) });
    const bytes = encoder.encode(`Casper Message:\n${message}`);
    const signature = Buffer.from(secp256k1.sign(sha256(bytes), privateKey).toCompactRawBytes()).toString("hex");

    expect(verifyCasperMessageSignature({ message, publicKeyHex: publicKey, signatureHex: signature })).toBe(true);
    expect(verifyCasperMessageSignature({ message, publicKeyHex: publicKey, signatureHex: `01${signature}` })).toBe(false);
  });

  it("rejects a signature tag that disagrees with the public key algorithm", () => {
    const privateKey = new Uint8Array(32).fill(9);
    const publicKey = `01${Buffer.from(ed25519.getPublicKey(privateKey)).toString("hex")}`;
    const message = "AgentPay test";
    const raw = Buffer.from(ed25519.sign(encoder.encode(`Casper Message:\n${message}`), privateKey)).toString("hex");

    expect(
      verifyCasperMessageSignature({ message, publicKeyHex: publicKey, signatureHex: `02${raw}` })
    ).toBe(false);
  });
});
