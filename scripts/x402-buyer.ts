// ⚠️  KEEP IN SYNC with apps/mcp-server/src/trust/x402Signer.ts.
// This file is a functionally-equivalent copy of apps/mcp-server/src/trust/x402Signer.ts with renamed exports
// (Casper* → X* prefix, required by apps/ naming constraints).
// The cryptographic logic (EIP-712 domain, payload digest, Casper signature tagging)
// MUST stay byte-for-byte identical between both files. Update both together.

// AgentPay x402 buyer signer.
//
// Produces the `PAYMENT-SIGNATURE` payload that the report API forwards to the configured Casper
// x402 facilitator's /verify + /settle. The EIP-712 digest is built with the official
// @casper-ecosystem/casper-eip-712 package (verified to reproduce the facilitator's Go digest),
// and signed with the exact Casper scheme used by casper-go-sdk so the facilitator's
// PublicKey.VerifySignature accepts it:
//   - secp256k1: 0x02 || ECDSA_secp256k1( sha256(digest) )  (RFC6979, low-S, r||s, 64 bytes)
//   - ed25519:   0x01 || ed25519.sign(digest)               (raw digest, 64 bytes)
// The payer account hash follows Casper's derivation: blake2b256( lower(algo) || 0x00 || pubKeyBytes ).

import { createPrivateKey } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { blake2b } from "@noble/hashes/blake2b";
import {
  hashTypedData,
  buildDomain,
  CASPER_DOMAIN_TYPES
} from "@casper-ecosystem/casper-eip-712";

export type CasperAlgo = "ed25519" | "secp256k1";

export type PaymentRequirement = {
  scheme: string;
  network: string;
  asset: string; // CEP-18 package hash, 64 hex chars
  amount: string;
  payTo: string; // 00 + 64 hex chars (account hash)
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; decimals?: string; symbol?: string };
};

export type PaymentResource = { url: string; description: string; mimeType: string };

export type X402SpendPolicy = {
  expectedPayeeAddress?: string;
  expectedX402Asset?: string;
  expectedNetwork?: string;
  maxReportAmount?: string;
};

export type CasperSigner = {
  algo: CasperAlgo;
  /** Full Casper public key hex: 01<32B> (ed25519) or 02<33B compressed> (secp256k1). */
  publicKeyHex: string;
  /** Payer account address: 00 + 64 hex account hash. */
  accountAddress: string;
  /** Returns a 65-byte Casper-tagged signature over a 32-byte digest. */
  sign(digest: Uint8Array): Uint8Array;
};

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

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/** Derive the Casper public key hex + account address from raw key bytes. */
function deriveIdentity(algo: CasperAlgo, publicKeyBytes: Uint8Array): {
  publicKeyHex: string;
  accountAddress: string;
} {
  const tag = algo === "ed25519" ? "01" : "02";
  const publicKeyHex = tag + toHex(publicKeyBytes);

  const algoBytes = new TextEncoder().encode(algo);
  const preimage = new Uint8Array(algoBytes.length + 1 + publicKeyBytes.length);
  preimage.set(algoBytes, 0);
  preimage[algoBytes.length] = 0;
  preimage.set(publicKeyBytes, algoBytes.length + 1);
  const accountHash = blake2b(preimage, { dkLen: 32 });
  return { publicKeyHex, accountAddress: "00" + toHex(accountHash) };
}

/** Build a Casper signer from a 32-byte raw private key. */
export function createCasperSigner(algo: CasperAlgo, privateKey: Uint8Array): CasperSigner {
  if (algo === "ed25519") {
    const publicKeyBytes = ed25519.getPublicKey(privateKey);
    const { publicKeyHex, accountAddress } = deriveIdentity("ed25519", publicKeyBytes);
    return {
      algo,
      publicKeyHex,
      accountAddress,
      sign(digest: Uint8Array): Uint8Array {
        const raw = ed25519.sign(digest, privateKey); // 64 bytes over the raw digest
        return tagged(0x01, raw);
      }
    };
  }

  const publicKeyBytes = secp256k1.getPublicKey(privateKey, true); // 33-byte compressed
  const { publicKeyHex, accountAddress } = deriveIdentity("secp256k1", publicKeyBytes);
  return {
    algo,
    publicKeyHex,
    accountAddress,
    sign(digest: Uint8Array): Uint8Array {
      const hash = sha256(digest);
      const signature = secp256k1.sign(hash, privateKey, { lowS: true }); // RFC6979 deterministic
      return tagged(0x02, signature.toCompactRawBytes()); // r||s, 64 bytes
    }
  };
}

function tagged(tag: number, raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + raw.length);
  out[0] = tag;
  out.set(raw, 1);
  return out;
}

/** Load a Casper signer from a PEM file's contents (ed25519 PKCS#8 or secp256k1 SEC1/PKCS#8). */
export function loadCasperSignerFromPem(pem: string): CasperSigner {
  const keyObject = createPrivateKey({ key: pem, format: "pem" });
  const jwk = keyObject.export({ format: "jwk" }) as {
    kty?: string;
    crv?: string;
    d?: string;
  };

  if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.d) {
    return createCasperSigner("ed25519", fromBase64Url(jwk.d));
  }
  if (jwk.kty === "EC" && jwk.crv === "secp256k1" && jwk.d) {
    return createCasperSigner("secp256k1", fromBase64Url(jwk.d));
  }
  throw new Error(`Unsupported Casper key PEM: kty=${jwk.kty ?? "?"} crv=${jwk.crv ?? "?"}`);
}

/**
 * EIP-712 digest for a Casper x402 `TransferWithAuthorization`. `from`/`to` are 66-hex Casper
 * addresses (tag byte + 32-byte account hash), exactly as carried in the authorization.
 */
export function transferWithAuthorizationDigest(input: {
  tokenName: string;
  tokenVersion: string;
  network: string;
  assetPackageHash: string; // 64 hex chars
  from: string; // 66 hex chars (00/01 + account hash)
  to: string; // 66 hex chars
  value: string;
  validAfter: number;
  validBefore: number;
  nonceHex: string; // 64 hex chars
}): Uint8Array {
  const domain = buildDomain(
    input.tokenName,
    input.tokenVersion,
    input.network,
    "0x" + input.assetPackageHash
  );
  const message = {
    from: "0x" + input.from,
    to: "0x" + input.to,
    value: BigInt(input.value),
    validAfter: BigInt(input.validAfter),
    validBefore: BigInt(input.validBefore),
    nonce: "0x" + input.nonceHex
  };
  return hashTypedData(
    domain,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    "TransferWithAuthorization",
    message,
    { domainTypes: CASPER_DOMAIN_TYPES }
  );
}

export type BuiltPaymentSignature = {
  paymentPayload: Record<string, unknown>;
  /** Base64 PAYMENT-SIGNATURE header value. */
  header: string;
  digestHex: string;
  authorization: Record<string, string>;
};

export function x402SpendPolicyFromEnv(env: Record<string, string | undefined> = process.env): X402SpendPolicy {
  return {
    expectedPayeeAddress: env.AGENT_PAY_EXPECTED_PAYEE_ADDRESS,
    expectedX402Asset: env.AGENT_PAY_EXPECTED_X402_ASSET,
    expectedNetwork: env.AGENT_PAY_EXPECTED_NETWORK,
    maxReportAmount: env.AGENT_PAY_MAX_REPORT_AMOUNT
  };
}

export function enforceX402SpendPolicy(requirement: PaymentRequirement, policy: X402SpendPolicy = x402SpendPolicyFromEnv()): void {
  if (policy.expectedPayeeAddress && normalizeAddress(policy.expectedPayeeAddress) !== normalizeAddress(requirement.payTo)) {
    throw new Error(
      `x402 spend policy refused to sign: payee address mismatch (AGENT_PAY_EXPECTED_PAYEE_ADDRESS expected ${policy.expectedPayeeAddress}, actual ${requirement.payTo})`
    );
  }
  if (policy.expectedX402Asset && normalizeAsset(policy.expectedX402Asset) !== normalizeAsset(requirement.asset)) {
    throw new Error(
      `x402 spend policy refused to sign: asset mismatch (AGENT_PAY_EXPECTED_X402_ASSET expected ${policy.expectedX402Asset}, actual ${requirement.asset})`
    );
  }
  if (policy.expectedNetwork && policy.expectedNetwork !== requirement.network) {
    throw new Error(
      `x402 spend policy refused to sign: network mismatch (AGENT_PAY_EXPECTED_NETWORK expected ${policy.expectedNetwork}, actual ${requirement.network})`
    );
  }
  if (policy.maxReportAmount) {
    const max = parsePolicyAmount("AGENT_PAY_MAX_REPORT_AMOUNT", policy.maxReportAmount);
    const actual = parsePolicyAmount("payment requirement amount", requirement.amount);
    if (actual > max) {
      throw new Error(
        `x402 spend policy refused to sign: amount exceeds AGENT_PAY_MAX_REPORT_AMOUNT (expected <= ${policy.maxReportAmount}, actual ${requirement.amount})`
      );
    }
  }
}

/**
 * Build the AgentPay PAYMENT-SIGNATURE payload for a quoted requirement. The top-level
 * `accepted`/`resource` satisfy the report API's quote binding; `payload` is the casper-x402
 * ExactCasperPayload the facilitator verifies and settles.
 */
export function buildX402PaymentSignature(input: {
  requirement: PaymentRequirement;
  resource: PaymentResource;
  signer: CasperSigner;
  policy?: X402SpendPolicy;
  /**
   * EIP-712 domain chain_name. Defaults to the CAIP-2 network id (`casper:casper-test`) — empirically
   * confirmed against the casper-x402 facilitator's /verify, which accepts the full id, not the bare
   * chain name. Override only if a facilitator/contract is configured with a different domain chain.
   */
  domainChainName?: string;
  now?: number; // unix seconds, injectable for tests
  nonce?: Uint8Array; // injectable for tests
}): BuiltPaymentSignature {
  const { requirement, resource, signer } = input;
  enforceX402SpendPolicy(requirement, input.policy);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const validAfter = now - 600;
  const validBefore = now + (requirement.maxTimeoutSeconds || 300);
  const nonce = input.nonce ?? secp256k1.utils.randomPrivateKey().slice(0, 32);
  const nonceHex = toHex(nonce);

  const digest = transferWithAuthorizationDigest({
    tokenName: requirement.extra.name,
    tokenVersion: requirement.extra.version,
    network: input.domainChainName ?? requirement.network,
    assetPackageHash: requirement.asset,
    from: signer.accountAddress,
    to: requirement.payTo,
    value: requirement.amount,
    validAfter,
    validBefore,
    nonceHex
  });

  const signature = signer.sign(digest);
  const authorization = {
    from: signer.accountAddress,
    to: requirement.payTo,
    value: requirement.amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce: nonceHex
  };
  const paymentPayload = {
    x402Version: 2,
    accepted: requirement,
    resource,
    payload: {
      signature: toHex(signature),
      publicKey: signer.publicKeyHex,
      authorization
    }
  };

  return {
    paymentPayload,
    header: Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64"),
    digestHex: toHex(digest),
    authorization
  };
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAsset(value: string): string {
  return value.trim().toLowerCase().replace(/^hash-/, "");
}

function parsePolicyAmount(label: string, value: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`x402 spend policy refused to sign: ${label} must be a non-negative integer amount in base units`);
  }
  return BigInt(value);
}
