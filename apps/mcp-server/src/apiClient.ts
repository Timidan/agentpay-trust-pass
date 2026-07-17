import type { EvidenceFactValue, EvidenceRecord, ProofStep, ReportProof } from "@agent-pay/core";
import { AgentPayHttpClient } from "@agent-pay/client";

const DEFAULT_TIMEOUT_MS = 15_000;
const SETTLEMENT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createPaymentAuditClient(baseUrl: string, token: string): AgentPayHttpClient {
  return new AgentPayHttpClient({ baseUrl, token });
}

export type SourceSummary = {
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  recordHash: string;
  facts: Record<string, EvidenceFactValue>;
};

export type EvidenceNetwork = "casper-mainnet" | "casper-testnet";

export type ResolvedToken = {
  symbol: string;
  packageHash: string;
  name: string | null;
  network: "casper-mainnet";
};

export type ResolvedCsprName = {
  name: string;
  accountHash: string;
  publicKey: string | null;
  expiresAt: string;
  isPrimary: boolean;
  network: "casper-mainnet";
  source: "CSPR.name";
  sourceUrl: string;
};

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

export type PaymentReadinessCheck = {
  name: string;
  status: "pass" | "fail" | "missing";
  message: string;
};

export type PaymentReadiness = {
  status: "ready" | "configuration_required" | "facilitator_unavailable" | "facilitator_unsupported";
  reason: string | null;
  checkedAt: string;
  checks: PaymentReadinessCheck[];
  supportedKind: {
    x402Version: number;
    scheme: string;
    network: string;
  } | null;
};

export type QuoteReportResult = {
  quoteId: string;
  reportId: string;
  reportHash: string;
  datasetId: string;
  datasetRoot: string;
  evidenceNetwork: EvidenceNetwork;
  amount: string;
  amountDisplay?: string;
  asset: string;
  assetPackageHash?: string | null;
  assetDecimals?: number | null;
  network: string;
  expiresAt: string;
  expiresInSeconds: number;
  paymentResource: PaymentResource;
  paymentRequirements: PaymentRequirement[];
  paymentConfigurationRequired: boolean;
  paymentConfigurationReason: string | null;
  paymentReadiness: PaymentReadiness;
  sourceSummary: SourceSummary[];
};

export type PaidReportResult = {
  datasetId: string;
  datasetRoot: string;
  evidenceNetwork: EvidenceNetwork;
  reportId: string;
  report: EvidenceRecord;
  reportHash: string;
  proof: ProofStep[];
  evidence: ReportProof[];
  paymentReceiptHash: string;
  payment: {
    scheme: "x402";
    status: "settled";
    transactionHash: string;
    amount: string;
    amountDisplay?: string;
    asset: string;
    assetSymbol: string;
    assetDecimals?: number | null;
    network: string;
    confirmation: {
      rpcUrl: string;
      method: "info_get_transaction";
      apiVersion: string | null;
      executionState: "executed" | "pending" | "unknown";
      blockHash: string | null;
      attempts: number;
      observedAt: string;
    };
    facilitatorHash: string;
  };
};

export async function getQuote(
  reportApiUrl: string,
  subject: string,
  evidenceNetwork?: EvidenceNetwork
): Promise<QuoteReportResult> {
  const query = new URLSearchParams({ subject });
  if (evidenceNetwork) query.set("network", evidenceNetwork);
  const url = `${reportApiUrl}/reports/quote?${query.toString()}`;
  return requestJson<QuoteReportResult>(url, {}, "Quote failed");
}

export async function getPaymentStatus(reportApiUrl: string): Promise<PaymentReadiness> {
  return requestJson<PaymentReadiness>(
    `${reportApiUrl}/reports/payment-status`,
    {},
    "Payment status failed"
  );
}

export async function resolveToken(
  reportApiUrl: string,
  symbol: string
): Promise<ResolvedToken> {
  const query = new URLSearchParams({ symbol });
  return requestJson<ResolvedToken>(
    `${reportApiUrl}/resolve?${query.toString()}`,
    {},
    "CSPR.trade token resolution failed"
  );
}

export async function resolveCsprName(
  reportApiUrl: string,
  name: string
): Promise<ResolvedCsprName | null> {
  const query = new URLSearchParams({ name });
  try {
    return await requestJson<ResolvedCsprName>(
      `${reportApiUrl}/resolve-account?${query.toString()}`,
      {},
      "CSPR.name account resolution failed"
    );
  } catch (error) {
    if (error instanceof ApiResponseError && error.status === 404) return null;
    throw error;
  }
}

export async function buyReport(input: {
  reportApiUrl: string;
  quoteId: string;
  paymentPayload?: unknown;
}): Promise<PaidReportResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const encodedPayment = encodePaymentPayload(input.paymentPayload);
  if (encodedPayment) {
    headers["PAYMENT-SIGNATURE"] = encodedPayment;
  }

  return requestJson<PaidReportResult>(
    `${input.reportApiUrl}/reports/buy/${encodeURIComponent(input.quoteId)}`,
    {
    method: "POST",
    headers,
    body: JSON.stringify({ quoteId: input.quoteId })
    },
    "Buy report failed",
    SETTLEMENT_TIMEOUT_MS
  );
}

export async function verifyReport(input: {
  reportApiUrl: string;
  record: EvidenceRecord;
  proof: ProofStep[];
  datasetRoot: string;
}): Promise<{ verified: boolean }> {
  return requestJson<{ verified: boolean }>(`${input.reportApiUrl}/reports/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: input.record,
      proof: input.proof,
      datasetRoot: input.datasetRoot
    })
  }, "Verify report failed");
}

export class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal
    });

    const bytes = await readBoundedBody(response, DEFAULT_MAX_RESPONSE_BYTES, label);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new ApiResponseError(`${label}: malformed JSON response`, 502, {
        error: "invalid_upstream_response"
      });
    }
    if (!response.ok) {
      throw new ApiResponseError(`${label}: ${response.status}`, response.status, body);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiResponseError) throw error;
    throw new ApiResponseError(`${label}: request failed`, 502, {
      error: "upstream_unavailable"
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response: Response, maximum: number, label: string): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^[0-9]+$/.test(contentLength) && BigInt(contentLength) > BigInt(maximum)) {
    await response.body?.cancel();
    throw new ApiResponseError(`${label}: response is too large`, 502, {
      error: "upstream_response_too_large"
    });
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
        throw new ApiResponseError(`${label}: response is too large`, 502, {
          error: "upstream_response_too_large"
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function encodePaymentPayload(paymentPayload: unknown): string | null {
  if (paymentPayload === undefined || paymentPayload === null) {
    return null;
  }
  if (typeof paymentPayload === "string") {
    return paymentPayload;
  }
  return Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64");
}
