import {
  authorizationDigest,
  compareSettlement,
  hashJson,
  normalizePackageHash,
  verifyAuthorizationSignature,
  type AuthorizationIntent,
  type PaymentAssetEvidence
} from "@agent-pay/core";
import { NodeRpcClient } from "./auditor/casperRpc.js";
import { fetchBoundedJson } from "./httpJson.js";

export const X402_VERSION = 2;
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

const DEFAULT_CASPER_FACILITATOR_URL = "https://x402-facilitator.cspr.cloud";
const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";
const DEFAULT_PAYMENT_TIMEOUT_SECONDS = 300;
const FACILITATOR_REQUEST_TIMEOUT_MS = 5_000;
const FACILITATOR_SETTLEMENT_TIMEOUT_MS = 65_000;

export type PaymentRequirement = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    decimals?: string;
    symbol?: string;
  };
};

export type PaymentResource = {
  url: string;
  description: string;
  mimeType: string;
};

export type PaymentRequired = {
  x402Version: typeof X402_VERSION;
  error: string;
  resource: PaymentResource;
  accepts: PaymentRequirement[];
};

export type PaymentReadinessCheck = {
  name: string;
  status: "pass" | "fail" | "missing";
  message: string;
};

export type PaymentReadiness = {
  status: "ready" | "configuration_required" | "facilitator_unavailable" | "facilitator_unsupported";
  reason: string | null;
  checkedAt: string;
  facilitatorUrl: string;
  checks: PaymentReadinessCheck[];
  supportedKind: {
    x402Version: number;
    scheme: string;
    network: string;
    feePayer: string | null;
  } | null;
};

export type SettledPayment = {
  scheme: "x402";
  status: "settled";
  receiptHash: string;
  transactionHash: string;
  confirmation: AgentPaySettlementConfirmation;
  facilitatorHash: string;
};

export type AgentPaySettlementConfirmation = {
  rpcUrl: string;
  method: "info_get_transaction";
  apiVersion: string | null;
  executionState: "executed" | "pending" | "unknown";
  blockHash: string | null;
  attempts: number;
  observedAt: string;
};

export function buildPaymentRequirement(input: {
  amount: string;
  assetPackageHash: string;
  network: string;
  payTo: string;
  tokenName: string;
  tokenVersion: string;
  tokenDecimals?: string;
  tokenSymbol?: string;
  maxTimeoutSeconds?: number;
}): PaymentRequirement {
  return {
    scheme: "exact",
    network: input.network,
    asset: input.assetPackageHash,
    amount: input.amount,
    payTo: input.payTo,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? DEFAULT_PAYMENT_TIMEOUT_SECONDS,
    extra: {
      name: input.tokenName,
      version: input.tokenVersion,
      ...(input.tokenDecimals ? { decimals: input.tokenDecimals } : {}),
      ...(input.tokenSymbol ? { symbol: input.tokenSymbol } : {})
    }
  };
}

export function buildPaymentResource(input: { quoteId: string; reportId: string; baseUrl: string }): PaymentResource {
  return {
    url: `${input.baseUrl.replace(/\/+$/, "")}/reports/buy/${input.quoteId}`,
    description: `AgentPay live evidence report ${input.reportId}`,
    mimeType: "application/json"
  };
}

export function buildPaymentRequired(input: {
  reason: string;
  resource: PaymentResource;
  requirement: PaymentRequirement | null;
}): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: input.reason,
    resource: input.resource,
    accepts: input.requirement ? [input.requirement] : []
  };
}

export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeX402PaymentHeader(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch (error) {
    throw new PaymentRejectedError("PAYMENT-SIGNATURE must be a Base64-encoded JSON payment payload", {
      isValid: false,
      invalidReason: "malformed_payload",
      invalidMessage: error instanceof Error ? error.message : "Invalid payment header"
    });
  }
}

export function configuredFacilitatorUrl(): string {
  const configured = (process.env.X402_FACILITATOR_URL ?? DEFAULT_CASPER_FACILITATOR_URL).trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new PaymentConfigurationError("X402_FACILITATOR_URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PaymentConfigurationError("X402_FACILITATOR_URL must use HTTP or HTTPS");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new PaymentConfigurationError("X402_FACILITATOR_URL must use HTTPS outside localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PaymentConfigurationError(
      "X402_FACILITATOR_URL must not include credentials, query parameters, or a fragment"
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export function configuredFacilitatorAuthorization(): string | undefined {
  return process.env.X402_FACILITATOR_AUTH_TOKEN ?? process.env.CSPR_CLOUD_ACCESS_TOKEN;
}

export async function checkPaymentReadiness(input: {
  requirement: PaymentRequirement | null;
  configurationReason: string | null;
  assetEvidence: PaymentAssetEvidence | null;
  assetEvidenceError: string | null;
}): Promise<PaymentReadiness> {
  const facilitatorUrl = configuredFacilitatorUrl();
  const authorization = configuredFacilitatorAuthorization();
  const checks: PaymentReadinessCheck[] = [];

  if (!input.requirement) {
    checks.push({
      name: "payment_requirement",
      status: "missing",
      message: input.configurationReason ?? "payment requirement is not configured"
    });
    return readiness("configuration_required", input.configurationReason ?? "payment_requirement_required", facilitatorUrl, checks);
  }

  checks.push({
    name: "payment_requirement",
    status: "pass",
    message: `${formatTokenAmount(input.requirement.amount, input.requirement.extra.decimals)} ${input.requirement.extra.symbol ?? input.requirement.extra.name} on ${input.requirement.network} (${input.requirement.amount} base units)`
  });

  const assetFailure = paymentAssetFailure(input.requirement, input.assetEvidence, input.assetEvidenceError);
  if (assetFailure) {
    checks.push({
      name: "payment_asset",
      status: "fail",
      message: assetFailure.message
    });
    return readiness("configuration_required", assetFailure.reason, facilitatorUrl, checks);
  }
  checks.push({
    name: "payment_asset",
    status: "pass",
    message: "fee token metadata and transfer_with_authorization match Casper state"
  });

  if (isCsprCloudFacilitator(facilitatorUrl) && !authorization) {
    checks.push({
      name: "facilitator_authorization",
      status: "missing",
      message: "CSPR_CLOUD_ACCESS_TOKEN or X402_FACILITATOR_AUTH_TOKEN is required"
    });
    return readiness("configuration_required", "x402_facilitator_auth_required", facilitatorUrl, checks);
  }

  checks.push({
    name: "facilitator_authorization",
    status: "pass",
    message: authorization ? "authorization configured" : "authorization not required by configured facilitator"
  });

  let supportedPayload: unknown;
  try {
    supportedPayload = await getFacilitatorSupported(facilitatorUrl, authorization);
  } catch {
    checks.push({
      name: "facilitator_supported",
      status: "fail",
      message: "configured payment service could not be reached"
    });
    return readiness("facilitator_unavailable", "x402_facilitator_supported_check_failed", facilitatorUrl, checks);
  }

  const supportedKind = findSupportedKind(supportedPayload, input.requirement);
  if (!supportedKind) {
    checks.push({
      name: "facilitator_supported",
      status: "fail",
      message: `facilitator does not list x402 v${X402_VERSION} exact payments for ${input.requirement.network}`
    });
    return readiness("facilitator_unsupported", "x402_facilitator_network_unsupported", facilitatorUrl, checks);
  }

  checks.push({
    name: "facilitator_supported",
    status: "pass",
    message: `facilitator supports exact payments for ${supportedKind.network}`
  });

  return readiness("ready", null, facilitatorUrl, checks, supportedKind);
}

export function formatTokenAmount(amount: string, decimals: string | undefined): string {
  if (!/^(0|[1-9][0-9]*)$/.test(amount)) return amount;
  if (decimals === undefined || !/^(0|[1-9][0-9]{0,2})$/.test(decimals)) return amount;
  const places = Number(decimals);
  if (places === 0) return amount;
  const padded = amount.padStart(places + 1, "0");
  const whole = padded.slice(0, -places);
  const fraction = padded.slice(-places).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export async function settleX402Payment(input: {
  paymentPayload: unknown;
  requirement: PaymentRequirement;
  resource: PaymentResource;
}): Promise<SettledPayment> {
  const facilitatorUrl = configuredFacilitatorUrl();
  const authorization = configuredFacilitatorAuthorization();
  if (isCsprCloudFacilitator(facilitatorUrl) && !authorization) {
    throw new PaymentConfigurationError(
      "CSPR_CLOUD_ACCESS_TOKEN or X402_FACILITATOR_AUTH_TOKEN is required for CSPR.cloud x402 settlement"
    );
  }

  const signedAuthorization = validatePaymentPayloadBinding(
    input.paymentPayload,
    input.requirement,
    input.resource
  );

  const verify = await postFacilitator(facilitatorUrl, "verify", authorization, {
    paymentPayload: input.paymentPayload,
    paymentRequirements: input.requirement
  });

  const verifyRecord = asRecord(verify);
  if (verifyRecord?.valid !== true && verifyRecord?.isValid !== true) {
    throw new PaymentRejectedError("x402 payment verification rejected the payload", verify);
  }

  const settle = await postFacilitator(facilitatorUrl, "settle", authorization, {
    paymentPayload: input.paymentPayload,
    paymentRequirements: input.requirement
  });
  const settleRecord = asRecord(settle);
  // Fail closed, mirroring the verify check above: only an explicit success
  // proceeds. An ambiguous settle body is still gated by the tx-hash check and
  // the on-chain byte-match, but it must not read as a settlement here.
  if (settleRecord?.success !== true) {
    throw new PaymentRejectedError("x402 payment settlement rejected the payload", settle);
  }

  const transactionHash =
    asString(settleRecord?.transaction) ??
    asString(settleRecord?.transactionHash) ??
    asString(settleRecord?.txHash) ??
    asString(settleRecord?.transaction_hash);
  if (!transactionHash) {
    throw new PaymentRejectedError("x402 payment settlement returned no Casper transaction hash", {
      isValid: false,
      invalidReason: "missing_transaction_hash",
      invalidMessage: "Settlement succeeded but did not return a Casper deploy or transaction hash.",
      settle
    });
  }
  if (!/^[0-9a-f]{64}$/i.test(transactionHash)) {
    throw new PaymentRejectedError("x402 payment settlement returned a malformed Casper transaction hash", {
      isValid: false,
      invalidReason: "invalid_transaction_hash",
      invalidMessage: "Settlement transaction hash must be 64 hex characters.",
      settle
    });
  }
  const confirmation = await confirmPaymentSettlement(transactionHash, signedAuthorization.intent);
  const facilitatorHash = hashJson({ verify, settle });

  return {
    scheme: "x402",
    status: "settled",
    receiptHash: hashJson({
      scheme: "x402",
      transactionHash,
      facilitatorHash,
      authorization: signedAuthorization.intent,
      requirement: input.requirement,
      resource: input.resource
    }),
    transactionHash,
    confirmation,
    facilitatorHash
  };
}

export class PaymentConfigurationError extends Error {
  readonly name = "PaymentConfigurationError";
}

export class PaymentRejectedError extends Error {
  readonly name = "PaymentRejectedError";

  constructor(
    message: string,
    readonly settlementResponse: unknown = null
  ) {
    super(message);
  }
}

function validatePaymentPayloadBinding(
  paymentPayload: unknown,
  requirement: PaymentRequirement,
  resource: PaymentResource
): { intent: AuthorizationIntent; signature: string } {
  const payload = asRecord(paymentPayload);
  if (!payload) {
    throw new PaymentRejectedError("x402 payment payload must be a JSON object", {
      isValid: false,
      invalidReason: "malformed_payload",
      invalidMessage: "PAYMENT-SIGNATURE must decode to a JSON object."
    });
  }

  if (payload.x402Version !== X402_VERSION) {
    throw new PaymentRejectedError("x402 payment payload version does not match AgentPay quote", {
      isValid: false,
      invalidReason: "x402_version_mismatch",
      invalidMessage: `Expected x402Version ${X402_VERSION}.`
    });
  }

  const acceptedHash = hashJson(payload.accepted);
  const requirementHash = hashJson(requirement);
  if (acceptedHash !== requirementHash) {
    throw new PaymentRejectedError("x402 payment payload does not accept the quoted AgentPay requirement", {
      isValid: false,
      invalidReason: "payment_requirement_mismatch",
      invalidMessage: "Payment payload accepted requirement must match the active quote.",
      expectedHash: requirementHash,
      receivedHash: acceptedHash
    });
  }

  const resourceHash = hashJson(payload.resource);
  const quotedResourceHash = hashJson(resource);
  if (resourceHash !== quotedResourceHash) {
    throw new PaymentRejectedError("x402 payment payload resource does not match the AgentPay quote", {
      isValid: false,
      invalidReason: "payment_resource_mismatch",
      invalidMessage: "Payment payload resource must match the active quote.",
      expectedHash: quotedResourceHash,
      receivedHash: resourceHash
    });
  }

  return parseSignedAuthorization(payload, requirement);
}

function parseSignedAuthorization(
  paymentPayload: Record<string, unknown>,
  requirement: PaymentRequirement
): { intent: AuthorizationIntent; signature: string } {
  const signed = asRecord(paymentPayload.payload);
  const authorization = asRecord(signed?.authorization);
  const publicKey = asString(signed?.publicKey)?.toLowerCase();
  const signature = asString(signed?.signature)?.toLowerCase();
  const from = asString(authorization?.from)?.toLowerCase();
  const to = asString(authorization?.to)?.toLowerCase();
  const amount = asString(authorization?.value);
  const validAfter = asString(authorization?.validAfter);
  const validBefore = asString(authorization?.validBefore);
  const nonce = asString(authorization?.nonce)?.toLowerCase().replace(/^0x/, "");

  if (
    requirement.network !== "casper:casper-test" ||
    !publicKey ||
    !signature ||
    !from ||
    !to ||
    !amount ||
    !validAfter ||
    !validBefore ||
    !nonce
  ) {
    throw invalidAuthorization("x402 payment payload must contain a complete Casper authorization");
  }
  if (
    to !== requirement.payTo.toLowerCase() ||
    amount !== requirement.amount ||
    !/^(0|[1-9][0-9]*)$/.test(validAfter) ||
    !/^(0|[1-9][0-9]*)$/.test(validBefore) ||
    !/^[0-9a-f]{64}$/.test(nonce)
  ) {
    throw invalidAuthorization("x402 signed authorization does not match the quoted payment terms");
  }

  const after = BigInt(validAfter);
  const before = BigInt(validBefore);
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const maximumWindow = BigInt(requirement.maxTimeoutSeconds);
  if (before <= after || before <= now || after > now + 5n || before - after > maximumWindow) {
    throw invalidAuthorization("x402 signed authorization validity window is not currently usable");
  }

  const withoutDigest = {
    payerPublicKey: publicKey,
    from,
    to,
    amount,
    validAfter,
    validBefore,
    nonce,
    network: requirement.network,
    asset: normalizePackageHash(requirement.asset),
    tokenName: requirement.extra.name,
    tokenVersion: requirement.extra.version
  } satisfies Omit<AuthorizationIntent, "digest">;
  let intent: AuthorizationIntent;
  try {
    intent = { ...withoutDigest, digest: authorizationDigest(withoutDigest) };
  } catch {
    throw invalidAuthorization("x402 signed authorization contains malformed Casper fields");
  }
  if (!verifyAuthorizationSignature(intent, signature)) {
    throw invalidAuthorization("x402 payment authorization signature is invalid");
  }
  return { intent, signature };
}

function invalidAuthorization(message: string): PaymentRejectedError {
  return new PaymentRejectedError(message, {
    isValid: false,
    invalidReason: "invalid_payment_authorization",
    invalidMessage: message
  });
}

async function postFacilitator(
  baseUrl: string,
  action: "verify" | "settle",
  authorization: string | undefined,
  body: unknown
) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json"
  };
  if (authorization) {
    headers.authorization = authorization;
  }

  const { response, body: payload } = await fetchBoundedJson(
    `${baseUrl.replace(/\/+$/, "")}/${action}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    },
    {
      timeoutMs:
        action === "settle"
          ? FACILITATOR_SETTLEMENT_TIMEOUT_MS
          : FACILITATOR_REQUEST_TIMEOUT_MS
    }
  );
  if (!response.ok) {
    throw new PaymentRejectedError(`${action} failed with ${response.status}: ${JSON.stringify(payload)}`, payload);
  }
  return payload;
}

async function getFacilitatorSupported(baseUrl: string, authorization: string | undefined) {
  const headers: Record<string, string> = {
    accept: "application/json"
  };
  if (authorization) {
    headers.authorization = authorization;
  }

  const { response, body: payload } = await fetchBoundedJson(
    `${baseUrl.replace(/\/+$/, "")}/supported`,
    {
      method: "GET",
      headers
    },
    {
      timeoutMs: FACILITATOR_REQUEST_TIMEOUT_MS
    }
  );
  if (!response.ok) {
    throw new Error(`supported failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function findSupportedKind(payload: unknown, requirement: PaymentRequirement): PaymentReadiness["supportedKind"] {
  const payloadRecord = asRecord(payload);
  const kinds = payloadRecord && Array.isArray(payloadRecord.kinds) ? payloadRecord.kinds : [];
  for (const kind of kinds) {
    const kindRecord = asRecord(kind);
    const extra = asRecord(kindRecord?.extra);
    if (
      kindRecord?.x402Version === X402_VERSION &&
      kindRecord.scheme === requirement.scheme &&
      kindRecord.network === requirement.network
    ) {
      return {
        x402Version: X402_VERSION,
        scheme: requirement.scheme,
        network: requirement.network,
        feePayer: asString(extra?.feePayer)
      };
    }
  }
  return null;
}

function paymentAssetFailure(
  requirement: PaymentRequirement,
  evidence: PaymentAssetEvidence | null,
  evidenceError: string | null
): { reason: string; message: string } | null {
  if (!evidence || evidenceError) {
    return {
      reason: "x402_asset_evidence_unavailable",
      message: "AgentPay could not read the configured fee token from Casper RPC"
    };
  }
  const criticalMissing = new Set([
    "package",
    "activeContractHash",
    "authorizationEntrypoint",
    "name",
    "symbol",
    "decimals"
  ]);
  const criticalSourceFailure = evidence.sourceErrors.length > 0 &&
    evidence.missing.some((field) => criticalMissing.has(field));
  if (criticalSourceFailure) {
    const missingPackage = evidence.packageExists === false && evidence.sourceErrors.some(
      (message) => /^package:.*(?:not found|value.*missing)/i.test(message)
    );
    return missingPackage
      ? {
          reason: "x402_asset_package_not_found",
          message: "the configured fee token package was not found on Casper Testnet"
        }
      : {
          reason: "x402_asset_evidence_unavailable",
          message: "AgentPay could not read the configured fee token from Casper RPC"
        };
  }
  if (evidence.packageExists === null || evidence.authorizationEntrypoint === null) {
    return {
      reason: "x402_asset_evidence_unavailable",
      message: "AgentPay could not read the configured fee token from Casper RPC"
    };
  }
  if (
    evidence.packageExists === false ||
    evidence.packageHash.toLowerCase() !== requirement.asset.toLowerCase()
  ) {
    return {
      reason: "x402_asset_package_not_found",
      message: "the configured fee token package was not found on Casper Testnet"
    };
  }
  if (evidence.authorizationEntrypoint === false) {
    return {
      reason: "x402_asset_authorization_entrypoint_missing",
      message: "the configured fee token does not expose transfer_with_authorization"
    };
  }
  if (evidence.name === null || evidence.symbol === null || evidence.decimals === null) {
    return {
      reason: "x402_asset_metadata_unavailable",
      message: "AgentPay could not read the fee token name, symbol, and decimals from Casper"
    };
  }
  const expectedDecimals = requirement.extra.decimals;
  if (
    evidence.name !== requirement.extra.name ||
    (requirement.extra.symbol !== undefined && evidence.symbol !== requirement.extra.symbol) ||
    (expectedDecimals !== undefined && evidence.decimals !== Number(expectedDecimals))
  ) {
    return {
      reason: "x402_asset_metadata_mismatch",
      message: "the configured fee token name, symbol, or decimals differ from Casper state"
    };
  }
  return null;
}

function readiness(
  status: PaymentReadiness["status"],
  reason: string | null,
  facilitatorUrl: string,
  checks: PaymentReadinessCheck[],
  supportedKind: PaymentReadiness["supportedKind"] = null
): PaymentReadiness {
  return {
    status,
    reason,
    checkedAt: new Date().toISOString(),
    facilitatorUrl,
    checks,
    supportedKind
  };
}

async function confirmPaymentSettlement(
  transactionHash: string,
  approved: AuthorizationIntent
): Promise<AgentPaySettlementConfirmation> {
  const rpcUrl = process.env.CASPER_RPC_URL ?? DEFAULT_CASPER_RPC_URL;
  const attempts = readPositiveInteger("CASPER_CONFIRMATION_ATTEMPTS", 5);
  const delayMs = readNonNegativeInteger("CASPER_CONFIRMATION_DELAY_MS", 1500);
  const rpc = new NodeRpcClient({ rpcUrl });
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result: unknown;
    try {
      result = await rpc.getTransaction(transactionHash);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "settlement transaction lookup failed";
      if (attempt < attempts) await sleep(delayMs);
      continue;
    }
    const observedAt = new Date().toISOString();
    const proof = compareSettlement({
      checkId: "legacy-paid-report",
      transactionHash,
      approved,
      rpcEnvelope: result,
      rpcEndpoint: rpcUrl,
      observedAt
    });
    if (proof.verdict === "match") {
      return {
        rpcUrl,
        method: "info_get_transaction",
        apiVersion: rpcApiVersion(result),
        executionState: "executed",
        blockHash: proof.blockHash,
        attempts: attempt,
        observedAt
      };
    }
    if (proof.verdict === "mismatch") {
      throw new PaymentRejectedError("Casper settlement does not match the signed x402 authorization", {
        isValid: false,
        invalidReason: "settlement_transaction_mismatch",
        invalidMessage: "The finalized transaction differs from the signed payment authorization.",
        transactionHash,
        reasons: proof.reasons
      });
    }
    if (proof.verdict === "unverifiable") {
      throw new PaymentRejectedError("Casper settlement transaction shape could not be verified", {
        isValid: false,
        invalidReason: "settlement_transaction_unverifiable",
        invalidMessage: "The finalized transaction was not a supported Casper x402 transfer.",
        transactionHash,
        reasons: proof.reasons
      });
    }
    lastError = "settlement_transaction_not_executed";

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new PaymentRejectedError("x402 payment settlement transaction was not executed on Casper RPC", {
    isValid: false,
    invalidReason:
      lastError === "settlement_transaction_not_executed"
        ? "settlement_transaction_not_executed"
        : "settlement_transaction_not_confirmed",
    invalidMessage: `Settlement transaction ${transactionHash} was not executed at ${rpcUrl} after ${attempts} attempts: ${lastError ?? "not found"}`,
    transactionHash
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isCsprCloudFacilitator(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "cspr.cloud" || hostname.endsWith(".cspr.cloud");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function rpcApiVersion(value: unknown): string | null {
  const root = asRecord(value);
  const unwrapped = asRecord(root?.value) ?? root;
  return asString(unwrapped?.api_version);
}

function readPositiveInteger(name: string, fallback: number): number {
  const configured = Number(process.env[name] ?? fallback);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

function readNonNegativeInteger(name: string, fallback: number): number {
  const configured = Number(process.env[name] ?? fallback);
  return Number.isInteger(configured) && configured >= 0 ? configured : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
