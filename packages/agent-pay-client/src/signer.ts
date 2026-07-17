import { createPrivateKey } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import {
  authorizationDigest,
  buildAuthorizationWindow,
  publicKeyToAccountAddress,
  transferWithAuthorizationDigest as coreTransferDigest,
  type AuthorizationIntent
} from "@agent-pay/core";

export type CasperAlgo = "ed25519" | "secp256k1";

export type PaymentRequirement = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; decimals?: string; symbol?: string };
};

export type PaymentResource = {
  url: string;
  description: string;
  mimeType: string;
};

export type X402SpendPolicy = {
  expectedPayeeAddress?: string;
  expectedX402Asset?: string;
  expectedNetwork?: string;
  maxReportAmount?: string;
};

export type CasperSigner = {
  algo: CasperAlgo;
  publicKeyHex: string;
  accountAddress: string;
  sign(digest: Uint8Array): Uint8Array | Promise<Uint8Array>;
};

export type BuiltPaymentSignature = {
  paymentPayload: Record<string, unknown>;
  header: string;
  digestHex: string;
  authorization: Record<string, string>;
};

export function createCasperSigner(algo: CasperAlgo, privateKey: Uint8Array): CasperSigner {
  if (!(privateKey instanceof Uint8Array) || privateKey.byteLength !== 32) {
    throw new TypeError("Casper private key must contain exactly 32 bytes");
  }
  const secret = new Uint8Array(privateKey);
  if (algo === "ed25519") {
    const publicKeyHex = `01${toHex(ed25519.getPublicKey(secret))}`;
    return {
      algo,
      publicKeyHex,
      accountAddress: publicKeyToAccountAddress(publicKeyHex),
      sign(digest: Uint8Array): Uint8Array {
        return tagged(0x01, ed25519.sign(digest, secret));
      }
    };
  }
  if (algo !== "secp256k1") throw new TypeError("Unsupported Casper signing algorithm");
  const publicKeyHex = `02${toHex(secp256k1.getPublicKey(secret, true))}`;
  return {
    algo,
    publicKeyHex,
    accountAddress: publicKeyToAccountAddress(publicKeyHex),
    sign(digest: Uint8Array): Uint8Array {
      const signature = secp256k1.sign(sha256(digest), secret, { lowS: true });
      return tagged(0x02, signature.toCompactRawBytes());
    }
  };
}

export function loadCasperSignerFromPem(pem: string): CasperSigner {
  if (typeof pem !== "string" || !pem.includes("PRIVATE KEY")) {
    throw new TypeError("Casper secret key must be a PEM private key");
  }
  const keyObject = createPrivateKey({ key: pem, format: "pem" });
  const jwk = keyObject.export({ format: "jwk" }) as { kty?: string; crv?: string; d?: string };
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.d) {
    return createCasperSigner("ed25519", fromBase64Url(jwk.d));
  }
  if (jwk.kty === "EC" && jwk.crv === "secp256k1" && jwk.d) {
    return createCasperSigner("secp256k1", fromBase64Url(jwk.d));
  }
  throw new TypeError(`Unsupported Casper key PEM: kty=${jwk.kty ?? "?"} crv=${jwk.crv ?? "?"}`);
}

export function transferWithAuthorizationDigest(input: {
  tokenName: string;
  tokenVersion: string;
  network: string;
  assetPackageHash: string;
  from: string;
  to: string;
  value: string;
  validAfter: number | string;
  validBefore: number | string;
  nonceHex: string;
}): Uint8Array {
  const digest = coreTransferDigest({
    tokenName: input.tokenName,
    tokenVersion: input.tokenVersion,
    network: input.network,
    assetPackageHash: input.assetPackageHash,
    from: input.from,
    to: input.to,
    value: input.value,
    validAfter: String(input.validAfter),
    validBefore: String(input.validBefore),
    nonce: input.nonceHex
  });
  return fromHex(digest);
}

export async function signAuthorizationIntent(
  signer: CasperSigner,
  intent: AuthorizationIntent
): Promise<string> {
  const digest = authorizationDigest(intent);
  if (digest !== intent.digest) throw new TypeError("Authorization digest does not match its canonical fields");
  if (signer.publicKeyHex.toLowerCase() !== intent.payerPublicKey.toLowerCase()) {
    throw new TypeError("Authorization payer public key does not match the local signer");
  }
  if (signer.accountAddress.toLowerCase() !== intent.from.toLowerCase()) {
    throw new TypeError("Authorization payer address does not match the local signer");
  }
  const signature = await signer.sign(fromHex(digest));
  validateTaggedSignature(signer, signature);
  return toHex(signature);
}

export function x402SpendPolicyFromEnv(
  env: Record<string, string | undefined> = process.env
): X402SpendPolicy {
  return {
    expectedPayeeAddress: env.AGENT_PAY_EXPECTED_PAYEE_ADDRESS,
    expectedX402Asset: env.AGENT_PAY_EXPECTED_X402_ASSET,
    expectedNetwork: env.AGENT_PAY_EXPECTED_NETWORK,
    maxReportAmount: env.AGENT_PAY_MAX_REPORT_AMOUNT
  };
}

export function enforceX402SpendPolicy(
  requirement: PaymentRequirement,
  policy: X402SpendPolicy = x402SpendPolicyFromEnv()
): void {
  const actual = parseTransferAmount(requirement.amount);
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
    const maximum = parsePolicyAmount("AGENT_PAY_MAX_REPORT_AMOUNT", policy.maxReportAmount);
    if (actual > maximum) {
      throw new Error(
        `x402 spend policy refused to sign: amount exceeds AGENT_PAY_MAX_REPORT_AMOUNT (expected <= ${policy.maxReportAmount}, actual ${requirement.amount})`
      );
    }
  }
}

function parseTransferAmount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(
      "x402 spend policy refused to sign: payment requirement amount must be a positive integer in base units"
    );
  }
  const amount = BigInt(value);
  if (amount > (1n << 256n) - 1n) {
    throw new Error(
      "x402 spend policy refused to sign: payment requirement amount exceeds the U256 transfer limit"
    );
  }
  return amount;
}

export function buildX402PaymentSignature(input: {
  requirement: PaymentRequirement;
  resource: PaymentResource;
  signer: CasperSigner;
  policy?: X402SpendPolicy;
  domainChainName?: string;
  now?: number;
  nonce?: Uint8Array;
}): BuiltPaymentSignature {
  enforceX402SpendPolicy(input.requirement, input.policy);
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  const window = buildAuthorizationWindow(now, input.requirement.maxTimeoutSeconds || 300);
  const validAfter = Number(window.validAfter);
  const validBefore = Number(window.validBefore);
  const nonce = input.nonce ?? secp256k1.utils.randomPrivateKey().slice(0, 32);
  const nonceHex = toHex(nonce);
  const digest = transferWithAuthorizationDigest({
    tokenName: input.requirement.extra.name,
    tokenVersion: input.requirement.extra.version,
    network: input.domainChainName ?? input.requirement.network,
    assetPackageHash: input.requirement.asset,
    from: input.signer.accountAddress,
    to: input.requirement.payTo,
    value: input.requirement.amount,
    validAfter,
    validBefore,
    nonceHex
  });
  const signed = input.signer.sign(digest);
  if (signed instanceof Promise) {
    throw new TypeError("Legacy buildX402PaymentSignature requires a synchronous signer");
  }
  validateTaggedSignature(input.signer, signed);
  const authorization = {
    from: input.signer.accountAddress,
    to: input.requirement.payTo,
    value: input.requirement.amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce: nonceHex
  };
  const paymentPayload = {
    x402Version: 2,
    accepted: input.requirement,
    resource: input.resource,
    payload: {
      signature: toHex(signed),
      publicKey: input.signer.publicKeyHex,
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

function validateTaggedSignature(signer: CasperSigner, signature: Uint8Array): void {
  const expectedTag = signer.algo === "ed25519" ? 1 : 2;
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 65 || signature[0] !== expectedTag) {
    throw new TypeError("Local signer returned a malformed Casper-tagged signature");
  }
}

function tagged(tag: number, raw: Uint8Array): Uint8Array {
  const output = new Uint8Array(raw.byteLength + 1);
  output[0] = tag;
  output.set(raw, 1);
  return output;
}

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "hex"));
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAsset(value: string): string {
  return value.trim().toLowerCase().replace(/^hash-/, "");
}

function parsePolicyAmount(label: string, value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`x402 spend policy refused to sign: ${label} must be a non-negative integer amount in base units`);
  }
  return BigInt(value);
}
