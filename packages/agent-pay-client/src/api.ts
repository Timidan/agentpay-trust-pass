import type {
  AuthorizationIntent,
  OriginalRequest,
  OriginalRequestInput,
  PaymentDecision,
  PaymentTerms,
  PurchaseReceipt,
  SettlementProof
} from "@agent-pay/core";

export type CheckPaymentInput = {
  request: OriginalRequestInput;
  paymentRequired: unknown;
  authorization: AuthorizationIntent | null;
  idempotencyKey: string;
};

export type PaymentCheck = {
  id: string;
  request: OriginalRequest;
  terms: PaymentTerms;
  authorization: AuthorizationIntent | null;
  decision: PaymentDecision;
  status: string;
  [key: string]: unknown;
};

export type CheckPaymentResult = {
  created: boolean;
  check: PaymentCheck;
};

export type VerifySettlementResult = {
  created: boolean;
  check: { id: string; status: string; [key: string]: unknown };
  proof: Pick<SettlementProof, "verdict" | "transactionHash"> & Partial<SettlementProof>;
  receipt: PurchaseReceipt | null;
};

export type ResponseObservationInput = {
  observerVersion: string;
  status: number;
  contentType: string | null;
  bodyBytes: number;
  bodyHash: string;
  observedAt: string;
};

export type ObservationResult = {
  created: boolean;
  observation: { checkId: string; [key: string]: unknown };
  receipt: PurchaseReceipt;
};

export type PaymentReceiptRecord = {
  receipt: PurchaseReceipt;
  anchorState: PurchaseReceipt["anchor"];
};

export interface AgentPayApi {
  check(input: CheckPaymentInput): Promise<CheckPaymentResult>;
  verifySettlement(checkId: string, transactionHash: string): Promise<VerifySettlementResult>;
  observe(checkId: string, observation: ResponseObservationInput): Promise<ObservationResult>;
  getReceipt(receiptId: string): Promise<PurchaseReceipt>;
}

export type AgentPayHttpClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class AgentPayHttpClient implements AgentPayApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: AgentPayHttpClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.username || url.password || url.search || url.hash) {
      throw new TypeError("AgentPay API URL must not include credentials, query parameters, or a fragment");
    }
    if (url.protocol !== "https:" && !isLocalHostname(url.hostname)) {
      throw new TypeError("AgentPay API URL must use HTTPS outside localhost");
    }
    if (!options.token || options.token.length < 32 || options.token.length > 512) {
      throw new TypeError("AgentPay API token is invalid");
    }
    this.baseUrl = url.toString().replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "AgentPay API timeout");
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "AgentPay API response limit"
    );
  }

  check(input: CheckPaymentInput): Promise<CheckPaymentResult> {
    return this.request("/v1/checks", {
      method: "POST",
      headers: { "idempotency-key": input.idempotencyKey },
      body: {
        request: input.request,
        paymentRequired: input.paymentRequired,
        authorization: input.authorization
      }
    });
  }

  verifySettlement(checkId: string, transactionHash: string): Promise<VerifySettlementResult> {
    return this.request(`/v1/checks/${encodeURIComponent(checkId)}/verify-settlement`, {
      method: "POST",
      body: { transactionHash }
    });
  }

  observe(checkId: string, observation: ResponseObservationInput): Promise<ObservationResult> {
    return this.request(`/v1/checks/${encodeURIComponent(checkId)}/response-observations`, {
      method: "POST",
      body: observation
    });
  }

  getReceiptRecord(receiptId: string): Promise<PaymentReceiptRecord> {
    return this.request<PaymentReceiptRecord>(`/v1/receipts/${encodeURIComponent(receiptId)}`, {
      method: "GET"
    });
  }

  async getReceipt(receiptId: string): Promise<PurchaseReceipt> {
    const result = await this.getReceiptRecord(receiptId);
    return result.receipt;
  }

  private async request<T>(
    path: string,
    input: { method: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }
  ): Promise<T> {
    const headers = new Headers(input.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    if (input.body !== undefined) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new AgentPayApiError("AgentPay API request failed", 0, null, true);
    }
    const body = await parseJson(response, this.maxResponseBytes);
    if (!response.ok) {
      const record = asRecord(body);
      throw new AgentPayApiError(
        typeof record?.message === "string" ? record.message : "AgentPay API rejected the request",
        response.status,
        body,
        record?.retryable === true
      );
    }
    return body as T;
  }
}

export class AgentPayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "AgentPayApiError";
  }
}

export function checkX402Payment(api: AgentPayApi, input: CheckPaymentInput): Promise<CheckPaymentResult> {
  return api.check(input);
}

export function verifyX402Settlement(
  api: AgentPayApi,
  checkId: string,
  transactionHash: string
): Promise<VerifySettlementResult> {
  return api.verifySettlement(checkId, transactionHash);
}

export function getPaymentReceipt(api: AgentPayApi, receiptId: string): Promise<PurchaseReceipt> {
  return api.getReceipt(receiptId);
}

export function getPaymentReceiptRecord(
  api: Pick<AgentPayHttpClient, "getReceiptRecord">,
  receiptId: string
): Promise<PaymentReceiptRecord> {
  return api.getReceiptRecord(receiptId);
}

async function parseJson(response: Response, maximum: number): Promise<unknown> {
  const text = new TextDecoder().decode(await readBoundedBody(response, maximum));
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentPayApiError("AgentPay API returned malformed JSON", response.status, null, false);
  }
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^[0-9]+$/.test(contentLength) && BigInt(contentLength) > BigInt(maximum)) {
    await response.body?.cancel();
    throw new AgentPayApiError("AgentPay API response was too large", response.status, null, false);
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
        throw new AgentPayApiError("AgentPay API response was too large", response.status, null, false);
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}


function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}
