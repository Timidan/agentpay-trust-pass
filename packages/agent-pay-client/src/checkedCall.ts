import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  artifactHash,
  authorizationDigest,
  buildAuthorizationIntent,
  decodePaymentRequiredHeader,
  normalizeOriginalRequest,
  normalizePaymentRequired,
  type AuthorizationIntent,
  type PaymentVerdict,
  type PurchaseReceipt,
  type SettlementVerdict
} from "@agent-pay/core";
import type {
  AgentPayApi,
  CheckPaymentResult,
  ObservationResult,
  VerifySettlementResult
} from "./api.js";
import { signAuthorizationIntent, type CasperSigner } from "./signer.js";

const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_SETTLEMENT_ATTEMPTS = 30;
const DEFAULT_SETTLEMENT_POLL_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const HASH = /^[0-9a-f]{64}$/i;

export type CheckedX402CallInput = {
  url: string;
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: unknown;
  signer: CasperSigner;
  api: AgentPayApi;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  nonce?: Uint8Array;
  maxResponseBytes?: number;
  settlementAttempts?: number;
  settlementPollMs?: number;
  requestTimeoutMs?: number;
};

export type CheckedX402CallResult = {
  response: Response;
  check: CheckPaymentResult["check"];
  settlement: VerifySettlementResult;
  observation: ObservationResult["observation"];
  receipt: PurchaseReceipt;
};

export class PaymentAuditError extends Error {
  constructor(
    message: string,
    readonly verdict: PaymentVerdict | SettlementVerdict,
    readonly checkId: string | null
  ) {
    super(message);
    this.name = "PaymentAuditError";
  }
}

export async function checkedX402Call(input: CheckedX402CallInput): Promise<CheckedX402CallResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const method = input.method ?? "GET";
  const requestTimeoutMs = positiveInteger(
    input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    "requestTimeoutMs"
  );
  const prepared = prepareBody(method, input.body, input.headers);
  const capturedAt = validNow(now());
  const initialResponse = await fetchImpl(input.url, {
    method,
    headers: prepared.headers,
    body: bodyInit(prepared.body),
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (initialResponse.status !== 402) {
    await cancelBody(initialResponse);
    throw new PaymentAuditError(
      `Expected x402 payment challenge, received HTTP ${initialResponse.status}`,
      "review",
      null
    );
  }
  const paymentRequiredHeader = initialResponse.headers.get("payment-required");
  await cancelBody(initialResponse);
  if (!paymentRequiredHeader) {
    throw new PaymentAuditError("402 response omitted PAYMENT-REQUIRED", "review", null);
  }
  let paymentRequired: unknown;
  try {
    paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
  } catch {
    throw new PaymentAuditError("402 response contained an invalid PAYMENT-REQUIRED header", "review", null);
  }
  const request = normalizeOriginalRequest({
    method,
    url: input.url,
    bodyHash: sha256(prepared.body),
    bodyBytes: prepared.body.byteLength,
    capturedAt,
    adapterVersion: "agent-pay-client/0.1.0"
  });
  const normalized = normalizePaymentRequired(paymentRequired, request);
  if (!normalized.ok) {
    throw new PaymentAuditError(
      normalized.reasons.map((reason) => reason.message).join("; "),
      "block",
      null
    );
  }
  const nonce = input.nonce ?? randomBytes(32);
  if (!(nonce instanceof Uint8Array) || nonce.byteLength !== 32) {
    throw new TypeError("x402 authorization nonce must contain exactly 32 bytes");
  }
  const authorization = buildAuthorizationIntent({
    terms: normalized.terms,
    payerPublicKey: input.signer.publicKeyHex,
    nowEpochSeconds: Math.floor(Date.parse(capturedAt) / 1_000),
    nonce: Buffer.from(nonce).toString("hex")
  });

  const checkResult = await input.api.check({
    request: {
      method,
      url: input.url,
      bodyHash: request.bodyHash,
      bodyBytes: request.bodyBytes,
      capturedAt: request.capturedAt,
      adapterVersion: request.adapterVersion
    },
    paymentRequired,
    authorization,
    idempotencyKey: input.idempotencyKey ?? randomUUID()
  });
  verifyCheckBinding(checkResult, request.requestHash, normalized.terms.requirementHash, authorization);
  if (checkResult.check.decision.verdict !== "pay") {
    throw new PaymentAuditError(
      `AgentPay returned ${checkResult.check.decision.verdict.toUpperCase()} before signing`,
      checkResult.check.decision.verdict,
      checkResult.check.id
    );
  }

  const signature = await signAuthorizationIntent(input.signer, authorization);
  const paymentPayload = buildPaymentPayload(paymentRequired, normalized.terms.acceptanceIndex, authorization, signature);
  const paidHeaders = new Headers(prepared.headers);
  paidHeaders.set("payment-signature", Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64"));
  const paidResponse = await fetchImpl(input.url, {
    method,
    headers: paidHeaders,
    body: bodyInit(prepared.body),
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const maximum = positiveInteger(input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes");
  const responseBytes = await readBoundedBody(paidResponse, maximum, checkResult.check.id);
  const transactionHash = extractTransactionHash(paidResponse.headers, responseBytes);
  if (!transactionHash) {
    throw new PaymentAuditError("Paid response omitted the Casper transaction hash", "unverifiable", checkResult.check.id);
  }

  const settlement = await pollSettlement(
    input.api,
    checkResult.check.id,
    transactionHash,
    positiveInteger(input.settlementAttempts ?? DEFAULT_SETTLEMENT_ATTEMPTS, "settlementAttempts"),
    nonNegativeInteger(input.settlementPollMs ?? DEFAULT_SETTLEMENT_POLL_MS, "settlementPollMs")
  );
  if (settlement.proof.verdict !== "match") {
    throw new PaymentAuditError(
      `AgentPay settlement verdict was ${settlement.proof.verdict.toUpperCase()}`,
      settlement.proof.verdict,
      checkResult.check.id
    );
  }
  const observedAt = validNow(now());
  const observation = await input.api.observe(checkResult.check.id, {
    observerVersion: "agent-pay-client/0.1.0",
    status: paidResponse.status,
    contentType: paidResponse.headers.get("content-type"),
    bodyBytes: responseBytes.byteLength,
    bodyHash: sha256(responseBytes),
    observedAt
  });
  const replayableResponse = new Response(responseBytes.byteLength === 0 ? null : bodyInit(responseBytes), {
    status: paidResponse.status,
    statusText: paidResponse.statusText,
    headers: paidResponse.headers
  });
  return {
    response: replayableResponse,
    check: checkResult.check,
    settlement,
    observation: observation.observation,
    receipt: observation.receipt
  };
}

function verifyCheckBinding(
  result: CheckPaymentResult,
  requestHash: string,
  requirementHash: string,
  authorization: AuthorizationIntent
): void {
  const approved = result.check.authorization;
  if (!approved) throw new PaymentAuditError("AgentPay check omitted the authorization intent", "block", result.check.id);
  if (approved.digest !== authorization.digest) {
    throw new PaymentAuditError("AgentPay authorization digest differs from the local intent", "block", result.check.id);
  }
  if (authorizationDigest(approved) !== approved.digest || artifactHash(approved) !== artifactHash(authorization)) {
    throw new PaymentAuditError("AgentPay authorization fields differ from the local intent", "block", result.check.id);
  }
  if (result.check.request.requestHash !== requestHash || result.check.terms.requirementHash !== requirementHash) {
    throw new PaymentAuditError("AgentPay check does not bind the captured request and payment terms", "block", result.check.id);
  }
  if (
    result.check.decision.authorizationDigest !== authorization.digest &&
    result.check.decision.verdict === "pay"
  ) {
    throw new PaymentAuditError("AgentPay PAY decision omitted the local authorization digest", "block", result.check.id);
  }
}

function buildPaymentPayload(
  paymentRequired: unknown,
  acceptanceIndex: number,
  authorization: AuthorizationIntent,
  signature: string
): Record<string, unknown> {
  const root = asRecord(paymentRequired);
  const accepts = Array.isArray(root?.accepts) ? root.accepts : null;
  const accepted = accepts?.[acceptanceIndex];
  const resource = root?.resource;
  if (!accepted || !asRecord(resource)) throw new TypeError("Normalized x402 terms lost their source acceptance");
  return {
    x402Version: 2,
    accepted,
    resource,
    payload: {
      signature,
      publicKey: authorization.payerPublicKey,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.amount,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce
      }
    }
  };
}

async function pollSettlement(
  api: AgentPayApi,
  checkId: string,
  transactionHash: string,
  attempts: number,
  pollMilliseconds: number
): Promise<VerifySettlementResult> {
  let result: VerifySettlementResult | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await api.verifySettlement(checkId, transactionHash);
    if (result.proof.verdict === "match" || result.proof.verdict === "mismatch") return result;
    if (attempt + 1 < attempts && pollMilliseconds > 0) await delay(pollMilliseconds);
  }
  if (!result) throw new TypeError("Settlement polling requires at least one attempt");
  return result;
}

function extractTransactionHash(headers: Headers, body: Uint8Array): string | null {
  for (const name of ["payment-response", "x-payment-response"]) {
    const value = headers.get(name);
    if (!value) continue;
    const decoded = parseEncodedJson(value);
    const found = transactionHashFromValue(decoded);
    if (found) return found;
  }
  try {
    return transactionHashFromValue(JSON.parse(new TextDecoder().decode(body)) as unknown);
  } catch {
    return null;
  }
}

function transactionHashFromValue(value: unknown): string | null {
  const root = asRecord(value);
  if (!root) return null;
  const direct = [root.transactionHash, root.transaction_hash, root.txHash].find(isHash);
  if (typeof direct === "string") return direct.toLowerCase();
  for (const key of ["payment", "settlement", "result"]) {
    const nested = asRecord(root[key]);
    const candidate = nested?.transactionHash ?? nested?.transaction_hash ?? nested?.txHash;
    if (isHash(candidate)) return candidate.toLowerCase();
  }
  return null;
}

function parseEncodedJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    try {
      return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
}

function prepareBody(
  method: "GET" | "POST",
  value: unknown,
  headersInput: HeadersInit | undefined
): { headers: Headers; body: Uint8Array } {
  const headers = new Headers(headersInput);
  if (headers.has("payment-signature")) {
    throw new TypeError("Caller must not supply PAYMENT-SIGNATURE before AgentPay returns PAY");
  }
  if (method === "GET" && value !== undefined) throw new TypeError("GET x402 calls cannot include a request body");
  if (value === undefined) return { headers, body: new Uint8Array() };
  if (value instanceof Uint8Array) return { headers, body: value };
  if (typeof value === "string") return { headers, body: new TextEncoder().encode(value) };
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("x402 request body must be JSON serializable");
  headers.set("content-type", headers.get("content-type") ?? "application/json");
  return { headers, body: new TextEncoder().encode(serialized) };
}

function bodyInit(value: Uint8Array): ArrayBuffer | undefined {
  return value.byteLength === 0 ? undefined : Uint8Array.from(value).buffer;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The challenge body is deliberately ignored; transport cleanup failures do not change its headers.
  }
}

async function readBoundedBody(response: Response, maximum: number, checkId: string): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^[0-9]+$/.test(contentLength) && BigInt(contentLength) > BigInt(maximum)) {
    await cancelBody(response);
    throw new PaymentAuditError("Paid response exceeded the local body limit", "unverifiable", checkId);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new PaymentAuditError("Paid response exceeded the local body limit", "unverifiable", checkId);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PaymentAuditError) throw error;
    throw new PaymentAuditError("Paid response body could not be read", "unverifiable", checkId);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validNow(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("AgentPay client clock returned an invalid date");
  }
  return value.toISOString();
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
