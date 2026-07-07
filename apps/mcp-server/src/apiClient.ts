import type { EvidenceFactValue, EvidenceRecord, ProofStep, ReportProof } from "@agent-pay/core";

export type SourceSummary = {
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  recordHash: string;
  facts: Record<string, EvidenceFactValue>;
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
  facilitatorUrl: string;
  checks: PaymentReadinessCheck[];
  supportedKind: {
    x402Version: number;
    scheme: string;
    network: string;
    feePayer: string | null;
  } | null;
};

export type QuoteReportResult = {
  quoteId: string;
  reportId: string;
  reportHash: string;
  datasetId: string;
  datasetRoot: string;
  amount: string;
  asset: string;
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

export async function getQuote(reportApiUrl: string, subject: string): Promise<QuoteReportResult> {
  const url = `${reportApiUrl}/reports/quote?subject=${encodeURIComponent(subject)}`;
  const response = await fetch(url);
  return parseJsonResponse<QuoteReportResult>(response, "Quote failed");
}

export async function getPaymentStatus(reportApiUrl: string): Promise<PaymentReadiness> {
  const response = await fetch(`${reportApiUrl}/reports/payment-status`);
  return parseJsonResponse<PaymentReadiness>(response, "Payment status failed");
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

  const response = await fetch(`${input.reportApiUrl}/reports/buy/${encodeURIComponent(input.quoteId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ quoteId: input.quoteId })
  });
  return parseJsonResponse<PaidReportResult>(response, "Buy report failed");
}

export async function verifyReport(input: {
  reportApiUrl: string;
  record: EvidenceRecord;
  proof: ProofStep[];
  datasetRoot: string;
}): Promise<{ verified: boolean }> {
  const response = await fetch(`${input.reportApiUrl}/reports/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: input.record,
      proof: input.proof,
      datasetRoot: input.datasetRoot
    })
  });
  return parseJsonResponse<{ verified: boolean }>(response, "Verify report failed");
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

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new ApiResponseError(`${label}: ${response.status}`, response.status, body);
  }
  return body as T;
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
