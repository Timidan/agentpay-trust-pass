import { hashJson } from "@agent-pay/core";

export const X402_VERSION = 2;
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

const DEFAULT_CASPER_FACILITATOR_URL = "https://x402-facilitator.cspr.cloud";
const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";
const DEFAULT_PAYMENT_TIMEOUT_SECONDS = 300;

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
  return process.env.X402_FACILITATOR_URL ?? DEFAULT_CASPER_FACILITATOR_URL;
}

export function configuredFacilitatorAuthorization(): string | undefined {
  return process.env.X402_FACILITATOR_AUTH_TOKEN ?? process.env.CSPR_CLOUD_ACCESS_TOKEN;
}

export async function checkPaymentReadiness(input: {
  requirement: PaymentRequirement | null;
  configurationReason: string | null;
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
    message: `${input.requirement.amount} ${input.requirement.extra.symbol ?? input.requirement.extra.name} on ${input.requirement.network}`
  });

  if (facilitatorUrl.includes("cspr.cloud") && !authorization) {
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
  } catch (error) {
    checks.push({
      name: "facilitator_supported",
      status: "fail",
      message: error instanceof Error ? error.message : "facilitator supported endpoint failed"
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

export async function settleX402Payment(input: {
  paymentPayload: unknown;
  requirement: PaymentRequirement;
  resource: PaymentResource;
}): Promise<SettledPayment> {
  const facilitatorUrl = configuredFacilitatorUrl();
  const authorization = configuredFacilitatorAuthorization();
  if (facilitatorUrl.includes("cspr.cloud") && !authorization) {
    throw new PaymentConfigurationError(
      "CSPR_CLOUD_ACCESS_TOKEN or X402_FACILITATOR_AUTH_TOKEN is required for CSPR.cloud x402 settlement"
    );
  }

  validatePaymentPayloadBinding(input.paymentPayload, input.requirement, input.resource);

  const verify = await postFacilitator(facilitatorUrl, "verify", authorization, {
    paymentPayload: input.paymentPayload,
    paymentRequirements: input.requirement
  });

  const verifyRecord = asRecord(verify);
  if (verifyRecord?.valid === false || verifyRecord?.isValid === false) {
    throw new PaymentRejectedError("x402 payment verification rejected the payload", verify);
  }

  const settle = await postFacilitator(facilitatorUrl, "settle", authorization, {
    paymentPayload: input.paymentPayload,
    paymentRequirements: input.requirement
  });
  const settleRecord = asRecord(settle);
  if (settleRecord?.success === false) {
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
  const confirmation = await confirmPaymentSettlement(transactionHash);
  const facilitatorHash = hashJson({ verify, settle });

  return {
    scheme: "x402",
    status: "settled",
    receiptHash: hashJson({ scheme: "x402", transactionHash, facilitatorHash }),
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
) {
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

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as unknown;
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

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/supported`, {
    method: "GET",
    headers
  });
  const payload = (await response.json()) as unknown;
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

async function confirmPaymentSettlement(transactionHash: string): Promise<AgentPaySettlementConfirmation> {
  const rpcUrl = process.env.CASPER_RPC_URL ?? DEFAULT_CASPER_RPC_URL;
  const attempts = readPositiveInteger("CASPER_CONFIRMATION_ATTEMPTS", 5);
  const delayMs = readNonNegativeInteger("CASPER_CONFIRMATION_DELAY_MS", 1500);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await queryPaymentTransaction(rpcUrl, transactionHash, attempt);
    if ("confirmation" in result) {
      return result.confirmation;
    }
    lastError = result.reason;

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

type QueryPaymentTransactionResult =
  | { confirmation: AgentPaySettlementConfirmation }
  | { reason: string };

async function queryPaymentTransaction(
  rpcUrl: string,
  transactionHash: string,
  attempt: number
): Promise<QueryPaymentTransactionResult> {
  // Casper 2.0 JSON-RPC: info_get_transaction takes the transaction hash value directly
  // (not a {name,value} wrapper). A facilitator settlement may be a native TransactionV1 or a
  // legacy Deploy, so try Version1 first and only fall back to Deploy when it is not found.
  let lastReason = "settlement_transaction_not_confirmed";
  for (const variant of ["Version1", "Deploy"] as const) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "agent-pay-confirm-x402-payment",
        jsonrpc: "2.0",
        method: "info_get_transaction",
        params: { transaction_hash: { [variant]: transactionHash } }
      })
    });
    const body = (await response.json()) as CasperRpcEnvelope;
    if (!response.ok) {
      lastReason = `info_get_transaction HTTP ${response.status}`;
      continue;
    }
    if (body.error) {
      // A wrong-variant lookup returns "no such transaction"; keep trying the other variant.
      lastReason = `info_get_transaction RPC ${body.error.code}: ${body.error.message}`;
      continue;
    }

    const value = body.result?.value ?? body.result;
    if (!value?.transaction) {
      lastReason = "info_get_transaction response did not include a transaction";
      continue;
    }

    // The transaction exists under this variant; do not also query the other one.
    const executionInfo = value.execution_info;
    const executionState = readExecutionState(executionInfo);
    if (executionState !== "executed") {
      return { reason: "settlement_transaction_not_executed" };
    }

    return {
      confirmation: {
        rpcUrl,
        method: "info_get_transaction",
        apiVersion: typeof value.api_version === "string" ? value.api_version : null,
        executionState,
        blockHash: findNamedString(executionInfo, new Set(["block_hash", "blockHash"])) ?? null,
        attempts: attempt,
        observedAt: new Date().toISOString()
      }
    };
  }

  return { reason: lastReason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

type CasperRpcEnvelope = {
  result?: {
    value?: Record<string, unknown>;
    [key: string]: unknown;
  };
  error?: {
    code: number;
    message: string;
  };
};

function readExecutionState(executionInfo: unknown): AgentPaySettlementConfirmation["executionState"] {
  // Casper 1.x style: execution_info as an array (empty = not yet executed).
  if (Array.isArray(executionInfo)) {
    return executionInfo.length > 0 ? "executed" : "pending";
  }
  // Casper 2.0 style: execution_info is an object that gains execution_result once finalized.
  if (executionInfo && typeof executionInfo === "object") {
    const executionResult = (executionInfo as Record<string, unknown>).execution_result;
    if (!executionResult) {
      return "pending";
    }
    // A reverted settlement carries a non-null error_message; never release the report on it.
    const errorMessage = findNamedString(executionResult, new Set(["error_message"]));
    return errorMessage ? "unknown" : "executed";
  }
  if (executionInfo === null || executionInfo === undefined) {
    return "pending";
  }
  return "unknown";
}

function findNamedString(value: unknown, keys: Set<string>): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findNamedString(item, keys);
      if (result) {
        return result;
      }
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && typeof entry === "string") {
      return entry;
    }
    if (entry && typeof entry === "object") {
      const nested = findNamedString(entry, keys);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
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
