import {
  authorizationDigest,
  normalizePaymentRequired,
  verifyAuthorizationSignature
} from "../../../../packages/agent-pay-core/src/payment/index";
import {
  AuditApiError,
  type PaymentCheck,
  type ProbeInput,
  type ResponseObservationInput
} from "./api";

const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const HASH = /^[0-9a-f]{64}$/i;
const ALLOWED_HEADERS = new Set(["accept", "content-type"]);

export type CheckedWalletPaymentResult = {
  transactionHash: string;
  observation: ResponseObservationInput;
};

export type CheckedWalletPaymentInput = {
  check: PaymentCheck;
  paymentRequired: unknown;
  probeInput: ProbeInput;
  signAuthorization: (authorization: NonNullable<PaymentCheck["authorization"]>) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

export async function submitCheckedWalletPayment(
  input: CheckedWalletPaymentInput
): Promise<CheckedWalletPaymentResult> {
  const authorization = approvedAuthorization(input.check);
  const challenge = checkedChallenge(input.paymentRequired, input.check);
  const prepared = await checkedRequest(input.probeInput, input.check);
  const now = validNow((input.now ?? (() => new Date()))());
  const nowEpochSeconds = Math.floor(Date.parse(now) / 1_000);
  if (
    nowEpochSeconds < Number(authorization.validAfter) ||
    nowEpochSeconds >= Number(authorization.validBefore)
  ) {
    throw paymentError(
      "payment_authorization_expired",
      "These payment details have expired. Prepare them again and rerun the check."
    );
  }

  const signature = await input.signAuthorization(authorization);
  if (!verifyAuthorizationSignature(authorization, signature)) {
    throw paymentError(
      "wallet_signature_invalid",
      "The wallet signature did not match the payment AgentPay approved."
    );
  }

  const payload = {
    x402Version: 2,
    accepted: challenge.accepted,
    resource: challenge.resource,
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
  const headers = new Headers(prepared.headers);
  headers.set("payment-signature", encodeBase64Json(payload));

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.check.request.url, {
      method: input.check.request.method,
      headers,
      body: prepared.body.byteLength === 0 ? undefined : Uint8Array.from(prepared.body).buffer,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(
        positiveInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, "payment request timeout")
      )
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
    throw paymentError(
      timedOut ? "payment_request_timeout" : "payment_request_failed",
      timedOut
        ? "The paid service did not respond before the request timed out."
        : "The paid service could not be reached. The same nonce prevents a second transfer, but check the service before retrying.",
      true
    );
  }

  const responseBytes = await readBoundedBody(
    response,
    positiveInteger(input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "payment response limit")
  );
  const transactionHash = extractTransactionHash(response.headers, responseBytes);
  if (!transactionHash) {
    throw paymentError(
      "payment_transaction_missing",
      "The paid service did not return a Casper transaction hash, so AgentPay cannot verify settlement."
    );
  }

  return {
    transactionHash,
    observation: {
      observerVersion: "agentpay-web/0.1.0",
      status: response.status,
      contentType: response.headers.get("content-type"),
      bodyBytes: responseBytes.byteLength,
      bodyHash: await sha256(responseBytes),
      observedAt: now
    }
  };
}

function approvedAuthorization(check: PaymentCheck): NonNullable<PaymentCheck["authorization"]> {
  if (check.decision.verdict !== "pay" || check.status !== "reserved" || !check.authorization) {
    throw paymentError(
      "payment_not_approved",
      "AgentPay must return PAY before Casper Wallet can sign this charge."
    );
  }
  if (
    authorizationDigest(check.authorization) !== check.authorization.digest.toLowerCase() ||
    check.decision.authorizationDigest !== check.authorization.digest
  ) {
    throw paymentError(
      "payment_authorization_changed",
      "The approved payment details no longer match the check. Rerun the check before paying."
    );
  }
  return check.authorization;
}

function checkedChallenge(
  paymentRequired: unknown,
  check: PaymentCheck
): { accepted: unknown; resource: Record<string, unknown> } {
  const normalized = normalizePaymentRequired(paymentRequired, check.request);
  if (!normalized.ok) {
    throw paymentError(
      "payment_charge_changed",
      "The service charge is no longer the one AgentPay checked. Run the check again."
    );
  }
  if (
    normalized.request.requestHash !== check.request.requestHash ||
    normalized.terms.requirementHash !== check.terms.requirementHash
  ) {
    throw paymentError(
      "payment_charge_changed",
      "The service charge is no longer the one AgentPay checked. Run the check again."
    );
  }
  const root = asRecord(paymentRequired);
  const accepted = Array.isArray(root?.accepts)
    ? root.accepts[normalized.terms.acceptanceIndex]
    : undefined;
  const resource = asRecord(root?.resource);
  if (!accepted || !resource) {
    throw paymentError(
      "payment_charge_changed",
      "The service charge no longer contains the checked payment option."
    );
  }
  return { accepted, resource };
}

async function checkedRequest(
  probeInput: ProbeInput,
  check: PaymentCheck
): Promise<{ headers: Headers; body: Uint8Array }> {
  const method = probeInput.method ?? "GET";
  let url: URL;
  try {
    url = new URL(probeInput.url);
  } catch {
    throw requestChanged();
  }
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHostname(url.hostname))) ||
    url.username ||
    url.password ||
    url.hash ||
    method !== check.request.method ||
    url.toString() !== check.request.url
  ) {
    throw requestChanged();
  }

  const headers = new Headers();
  for (const [rawName, value] of Object.entries(probeInput.headers ?? {})) {
    const name = rawName.toLowerCase();
    if (!ALLOWED_HEADERS.has(name) || /[\r\n]/.test(value)) throw requestChanged();
    headers.set(name, value);
  }
  if (headers.has("payment-signature") || headers.has("authorization")) throw requestChanged();

  let body = new Uint8Array();
  if (method === "GET") {
    if (probeInput.body !== undefined) throw requestChanged();
  } else if (probeInput.body !== undefined) {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(probeInput.body);
    } catch {
      throw requestChanged();
    }
    if (serialized === undefined) throw requestChanged();
    body = new TextEncoder().encode(serialized);
    headers.set("content-type", headers.get("content-type") ?? "application/json");
  }

  if (body.byteLength !== check.request.bodyBytes || (await sha256(body)) !== check.request.bodyHash) {
    throw requestChanged();
  }
  return { headers, body };
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^[0-9]+$/.test(contentLength) && BigInt(contentLength) > BigInt(maximum)) {
    await cancelBody(response);
    throw responseTooLarge();
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
        throw responseTooLarge();
      }
      chunks.push(value);
    }
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

function extractTransactionHash(headers: Headers, body: Uint8Array): string | null {
  for (const name of ["payment-response", "x-payment-response"]) {
    const value = headers.get(name);
    if (!value) continue;
    const found = transactionHashFromValue(parseEncodedJson(value));
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
  for (const candidate of [root.transactionHash, root.transaction_hash, root.txHash, root.transaction]) {
    if (typeof candidate === "string" && HASH.test(candidate)) return candidate.toLowerCase();
  }
  for (const key of ["payment", "settlement", "result"]) {
    const nested = asRecord(root[key]);
    if (!nested) continue;
    for (const candidate of [nested.transactionHash, nested.transaction_hash, nested.txHash, nested.transaction]) {
      if (typeof candidate === "string" && HASH.test(candidate)) return candidate.toLowerCase();
    }
  }
  return null;
}

function parseEncodedJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    try {
      return JSON.parse(new TextDecoder().decode(base64Bytes(value))) as unknown;
    } catch {
      return null;
    }
  }
}

function encodeBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw paymentError(
      "secure_browser_required",
      "This browser cannot verify the payment request. Update it before paying."
    );
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A cleanup failure cannot make an oversized response acceptable.
  }
}

function requestChanged(): AuditApiError {
  return paymentError(
    "payment_request_changed",
    "The URL, method, or request body changed after AgentPay checked it. Run the check again."
  );
}

function responseTooLarge(): AuditApiError {
  return paymentError(
    "payment_response_too_large",
    "The paid service returned more data than AgentPay can verify safely."
  );
}

function paymentError(code: string, message: string, retryable = false): AuditApiError {
  return new AuditApiError({ code, message, status: 0, retryable });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validNow(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("AgentPay browser clock returned an invalid date");
  }
  return value.toISOString();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
