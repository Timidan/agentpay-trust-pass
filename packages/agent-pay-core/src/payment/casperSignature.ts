import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalJson } from "./canonical.js";

export type CasperAlgorithm = "ed25519" | "secp256k1";

export type ParsedCasperPublicKey = {
  algorithm: CasperAlgorithm;
  algorithmTag: 1 | 2;
  rawKey: Uint8Array;
  publicKeyHex: string;
};

export function operatorActionMessage(action: unknown): string {
  return `AgentPay Operator Action v1\n${canonicalJson(action)}`;
}

export function publicKeyToAccountAddress(publicKeyHex: string): string {
  const parsed = parseCasperPublicKey(publicKeyHex);
  const algorithm = new TextEncoder().encode(parsed.algorithm);
  const preimage = new Uint8Array(algorithm.length + 1 + parsed.rawKey.length);
  preimage.set(algorithm);
  preimage[algorithm.length] = 0;
  preimage.set(parsed.rawKey, algorithm.length + 1);
  return `00${toHex(blake2b(preimage, { dkLen: 32 }))}`;
}

export function verifyCasperMessageSignature(input: {
  message: string;
  publicKeyHex: string;
  signatureHex: string;
}): boolean {
  try {
    const publicKey = parseCasperPublicKey(input.publicKeyHex);
    const signature = parseCasperSignature(input.signatureHex, publicKey.algorithmTag, true);
    const message = new TextEncoder().encode(`Casper Message:\n${input.message}`);

    return publicKey.algorithm === "ed25519"
      ? ed25519.verify(signature, message, publicKey.rawKey)
      : secp256k1.verify(signature, sha256(message), publicKey.rawKey, { lowS: true });
  } catch {
    return false;
  }
}

export function parseCasperPublicKey(value: string): ParsedCasperPublicKey {
  const normalized = normalizeHex(value, "Casper public key");
  const tag = normalized.slice(0, 2);
  const raw = fromHex(normalized.slice(2));

  if (tag === "01" && raw.length === 32) {
    return { algorithm: "ed25519", algorithmTag: 1, rawKey: raw, publicKeyHex: normalized };
  }
  if (tag === "02" && raw.length === 33) {
    return { algorithm: "secp256k1", algorithmTag: 2, rawKey: raw, publicKeyHex: normalized };
  }
  throw new TypeError("Casper public key must be tagged Ed25519 or compressed secp256k1");
}

export function parseCasperSignature(
  value: string,
  expectedTag: 1 | 2,
  allowUntagged: boolean
): Uint8Array {
  const normalized = normalizeHex(value, "Casper signature");
  const bytes = fromHex(normalized);
  if (bytes.length === 64 && allowUntagged) return bytes;
  if (bytes.length !== 65 || bytes[0] !== expectedTag) {
    throw new TypeError("Casper signature algorithm tag does not match the public key");
  }
  return bytes.slice(1);
}

function normalizeHex(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new TypeError(`${label} must be hexadecimal`);
  }
  return normalized;
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "hex"));
}

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}
