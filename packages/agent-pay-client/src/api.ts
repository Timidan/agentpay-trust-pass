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
};

export class AgentPayHttpClient implements AgentPayApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentPayHttpClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new TypeError("AgentPay API URL must use HTTPS outside localhost");
    }
    if (!options.token || options.token.length < 32 || options.token.length > 512) {
      throw new TypeError("AgentPay API token is invalid");
    }
    this.baseUrl = url.toString().replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
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

  async getReceipt(receiptId: string): Promise<PurchaseReceipt> {
    const result = await this.request<{ receipt: PurchaseReceipt }>(`/v1/receipts/${encodeURIComponent(receiptId)}`, {
      method: "GET"
    });
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
        body: input.body === undefined ? undefined : JSON.stringify(input.body)
      });
    } catch {
      throw new AgentPayApiError("AgentPay API request failed", 0, null, true);
    }
    const body = await parseJson(response);
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

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentPayApiError("AgentPay API returned malformed JSON", response.status, null, false);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
