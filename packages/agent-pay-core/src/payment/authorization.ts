import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  buildDomain,
  CASPER_DOMAIN_TYPES,
  hashTypedData
} from "@casper-ecosystem/casper-eip-712";
import {
  parseCasperPublicKey,
  parseCasperSignature,
  publicKeyToAccountAddress
} from "./casperSignature.js";
import type { AuthorizationIntent, PaymentTerms } from "./types.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^(?:(?:00|01)[0-9a-f]{64}|02[0-9a-f]{66})$/;
const POSITIVE_INTEGER = /^(0|[1-9][0-9]*)$/;
const AUTHORIZATION_CLOCK_SKEW_SECONDS = 5;

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

export type TransferAuthorizationDigestInput = {
  tokenName: string;
  tokenVersion: string;
  network: string;
  assetPackageHash: string;
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export type TransferAuthorizationTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: "TransferWithAuthorization";
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  domainTypes: Array<{ name: string; type: string }>;
};

export function transferWithAuthorizationTypedData(
  input: TransferAuthorizationDigestInput
): TransferAuthorizationTypedData {
  const asset = normalizePackageHash(input.assetPackageHash);
  const from = normalizeAddress(input.from, "from");
  const to = normalizeAddress(input.to, "to");
  const value = normalizeInteger(input.value, "value");
  const validAfter = normalizeInteger(input.validAfter, "validAfter");
  const validBefore = normalizeInteger(input.validBefore, "validBefore");
  const nonce = normalizeNonce(input.nonce);
  if (!input.tokenName || !input.tokenVersion || !input.network) {
    throw new TypeError("Authorization domain fields must be non-empty strings");
  }

  return {
    domain: buildDomain(input.tokenName, input.tokenVersion, input.network, `0x${asset}`),
    types: {
      TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization.map(
        (field) => ({ ...field })
      )
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: `0x${from}`,
      to: `0x${to}`,
      value: uint256Hex(value),
      validAfter: uint256Hex(validAfter),
      validBefore: uint256Hex(validBefore),
      nonce: `0x${nonce}`
    },
    domainTypes: CASPER_DOMAIN_TYPES.map((field) => ({ ...field }))
  };
}

export function transferWithAuthorizationDigest(input: TransferAuthorizationDigestInput): string {
  const typedData = transferWithAuthorizationTypedData(input);
  const digest = hashTypedData(
    typedData.domain,
    typedData.types,
    typedData.primaryType,
    typedData.message,
    { domainTypes: typedData.domainTypes }
  );
  return bytesToHex(digest);
}

export function buildAuthorizationIntent(input: {
  terms: PaymentTerms;
  payerPublicKey: string;
  nowEpochSeconds: number;
  nonce: string;
}): AuthorizationIntent {
  if (!Number.isSafeInteger(input.nowEpochSeconds) || input.nowEpochSeconds < 0) {
    throw new TypeError("nowEpochSeconds must be a non-negative safe integer");
  }
  const payerPublicKey = parseCasperPublicKey(input.payerPublicKey).publicKeyHex;
  const window = buildAuthorizationWindow(input.nowEpochSeconds, input.terms.maxTimeoutSeconds);
  const intentWithoutDigest = {
    payerPublicKey,
    from: publicKeyToAccountAddress(payerPublicKey),
    to: input.terms.payTo,
    amount: input.terms.amount,
    validAfter: window.validAfter,
    validBefore: window.validBefore,
    nonce: normalizeNonce(input.nonce),
    network: input.terms.network,
    asset: input.terms.asset,
    tokenName: input.terms.extra.name,
    tokenVersion: input.terms.extra.version
  } satisfies Omit<AuthorizationIntent, "digest">;

  return {
    ...intentWithoutDigest,
    digest: authorizationDigest(intentWithoutDigest)
  };
}

export function buildAuthorizationWindow(
  nowEpochSeconds: number,
  maxTimeoutSeconds: number
): { validAfter: string; validBefore: string } {
  if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0) {
    throw new TypeError("nowEpochSeconds must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new TypeError("maxTimeoutSeconds must be a positive safe integer");
  }

  // Preserve a small clock-skew allowance without exceeding the negotiated total window.
  const skew = Math.min(
    AUTHORIZATION_CLOCK_SKEW_SECONDS,
    maxTimeoutSeconds - 1,
    nowEpochSeconds
  );
  const validAfter = nowEpochSeconds - skew;
  return {
    validAfter: String(validAfter),
    validBefore: String(validAfter + maxTimeoutSeconds)
  };
}

export function authorizationDigest(intent: Omit<AuthorizationIntent, "digest"> | AuthorizationIntent): string {
  return transferWithAuthorizationDigest({
    tokenName: intent.tokenName,
    tokenVersion: intent.tokenVersion,
    network: intent.network,
    assetPackageHash: intent.asset,
    from: intent.from,
    to: intent.to,
    value: intent.amount,
    validAfter: intent.validAfter,
    validBefore: intent.validBefore,
    nonce: intent.nonce
  });
}

export function verifyAuthorizationSignature(intent: AuthorizationIntent, signatureHex: string): boolean {
  try {
    if (publicKeyToAccountAddress(intent.payerPublicKey) !== intent.from.toLowerCase()) return false;
    const computedDigest = authorizationDigest(intent);
    if (computedDigest !== intent.digest.toLowerCase()) return false;
    const publicKey = parseCasperPublicKey(intent.payerPublicKey);
    const signature = parseCasperSignature(signatureHex, publicKey.algorithmTag, false);
    const digest = hexToBytes(computedDigest);

    return publicKey.algorithm === "ed25519"
      ? ed25519.verify(signature, digest, publicKey.rawKey)
      : secp256k1.verify(signature, sha256(digest), publicKey.rawKey, { lowS: true });
  } catch {
    return false;
  }
}

function normalizePackageHash(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^hash-/, "");
  if (!HEX_64.test(normalized)) throw new TypeError("assetPackageHash must be 64 hexadecimal characters");
  return normalized;
}

function normalizeAddress(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/^account-hash-/, "00");
  if (!ADDRESS.test(normalized)) throw new TypeError(`${label} must be a tagged Casper address`);
  return normalized;
}

function normalizeInteger(value: string, label: string): string {
  if (!POSITIVE_INTEGER.test(value)) throw new TypeError(`${label} must be a non-negative integer string`);
  return value;
}

function normalizeNonce(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!HEX_64.test(normalized)) throw new TypeError("nonce must be 32 bytes of hexadecimal data");
  return normalized;
}

function uint256Hex(value: string): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
