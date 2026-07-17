// Thin /v1 auditor client for the web control surface.
//
// Auth model (verified against apps/report-api/src/auditor/{routes,auth}.ts):
//  - Every /v1 payment route authenticates a bearer token (Authorization:
//    Bearer <token>) or the agentpay_session cookie. There is no unauthenticated
//    write path; the only unauthenticated reads are a share-tokened receipt and
//    POST /receipts/verify.
//  - Two principals: an operator session (minted from a Casper-signed,
//    origin-bound challenge) and a scoped agent token.
//  - People can sign the session challenge through the injected Casper Wallet;
//    the private key stays in the extension. Agents and CLI users can supply a
//    scoped token. The resulting bearer token is held in memory only: never in
//    localStorage, a URL, analytics, or logs.
//
// The wire types are reused from @agent-pay/client (the canonical HTTP surface)
// so the browser never re-declares the contract; this client adds the routes
// the shared client omits (probes, provider decisions, receipt record polling).
import type {
  CheckPaymentResult,
  ObservationResult,
  PaymentCheck,
  PaymentReceiptRecord,
  ResponseObservationInput,
  VerifySettlementResult
} from "../../../../packages/agent-pay-client/src/api";
import type {
  AuthorizationIntent,
  OperatorPolicy,
  OriginalRequest,
  PaymentRequirement,
  PaymentTerms,
  ProviderDecision,
  Reason
} from "../../../../packages/agent-pay-core/src/payment/types";
import { agentPayServiceBase, publicEndpoint, reportApiBase } from "../runtime-origins";

export type {
  CheckPaymentResult,
  ObservationResult,
  PaymentCheck,
  PaymentReceiptRecord,
  ResponseObservationInput,
  VerifySettlementResult
};
export type { AuthorizationIntent, OperatorPolicy, PaymentTerms, ProviderDecision, Reason };

const REPORT_API_BASE = reportApiBase;
const AGENTPAY_SERVICE_BASE = agentPayServiceBase;
const REQUEST_TIMEOUT_MS = 20_000;
const CASPER_PACKAGE_HASH = /^(?:hash-)?[0-9a-f]{64}$/i;

export type ProbeInput = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
};

export type ProbeResponseMeta = {
  status: number;
  contentType: string | null;
  bodyBytes: number;
  bodyHash: string;
  observedAt: string;
};

// Mirrors ProbeResult in apps/report-api/src/auditor/probe.ts. `terms` is null
// when the target did not answer 402 with a supported x402 charge.
export type ProbeResult = {
  request: OriginalRequest;
  response: ProbeResponseMeta;
  paymentRequired: unknown | null;
  terms: PaymentTerms | null;
  advisories: Reason[];
  redirects: string[];
};

export type AgentPayServiceQuote = {
  quoteId: string;
  paymentResource: {
    url: string;
  };
  paymentRequirements: PaymentRequirement[];
  paymentReadiness: {
    status: "ready" | "configuration_required" | "facilitator_unavailable" | "facilitator_unsupported";
    reason: string | null;
  };
};

export type SessionChallenge = {
  challengeId: string;
  operatorPublicKey: string;
  purpose: "session";
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
};

export type OperatorActionDescriptor = {
  kind: "policy_revision" | "provider_decision" | "agent_token_issue" | "agent_token_revoke";
  artifactHash: string;
  revision: number;
};

export type OperatorActionChallenge = Omit<SessionChallenge, "purpose"> & {
  purpose: "operator_action";
};

export type OperatorSession = {
  token: string;
  operatorPublicKey: string;
  expiresAt: string;
};

export type CreateCheckBody = {
  request: OriginalRequest | Record<string, unknown>;
  paymentRequired: unknown;
  authorization: AuthorizationIntent | null;
};

// The structured error contract every /v1 route returns (auth.ts ApiErrorBody).
// We surface every field so the UI can render actionable backend reasons rather
// than generic toast text.
export class AuditApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly field: string | null;
  readonly expected: unknown;
  readonly received: unknown;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    retryable?: boolean;
    field?: string | null;
    expected?: unknown;
    received?: unknown;
  }) {
    super(input.message);
    this.name = "AuditApiError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.field = input.field ?? null;
    this.expected = input.expected ?? null;
    this.received = input.received ?? null;
  }
}

type RequestInput = {
  path: string;
  method: "GET" | "POST" | "DELETE";
  token?: string | null;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
};

export class AuditApiClient {
  private readonly baseUrl: string;
  private readonly serviceBaseUrl: string;

  constructor(baseUrl: string = REPORT_API_BASE, serviceBaseUrl: string = AGENTPAY_SERVICE_BASE) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.serviceBaseUrl = serviceBaseUrl.replace(/\/+$/, "");
  }

  probe(token: string, input: ProbeInput): Promise<ProbeResult> {
    return this.request<ProbeResult>({ path: "/v1/probes", method: "POST", token, body: input });
  }

  createSessionChallenge(operatorPublicKey: string): Promise<SessionChallenge> {
    return this.request<SessionChallenge>({
      path: "/v1/auth/challenges",
      method: "POST",
      body: { purpose: "session", operatorPublicKey }
    });
  }

  createOperatorSession(input: {
    challengeId: string;
    operatorPublicKey: string;
    signature: string;
  }): Promise<OperatorSession> {
    return this.request<OperatorSession>({
      path: "/v1/auth/sessions",
      method: "POST",
      body: input
    });
  }

  createActionChallenge(
    token: string,
    operatorPublicKey: string,
    action: OperatorActionDescriptor
  ): Promise<OperatorActionChallenge> {
    return this.request<OperatorActionChallenge>({
      path: "/v1/auth/challenges",
      method: "POST",
      token,
      body: { purpose: "operator_action", operatorPublicKey, action }
    });
  }

  async getCurrentPolicy(token: string): Promise<OperatorPolicy | null> {
    try {
      const result = await this.request<{ policy: OperatorPolicy | null }>({
        path: "/v1/policies/current",
        method: "GET",
        token
      });
      return result.policy;
    } catch (cause) {
      if (cause instanceof AuditApiError && cause.status === 404 && cause.code === "policy_not_found") {
        return null;
      }
      throw cause;
    }
  }

  createPolicyRevision(
    token: string,
    input: { challengeId: string; policy: OperatorPolicy }
  ): Promise<{ policy: OperatorPolicy }> {
    return this.request({ path: "/v1/policies/revisions", method: "POST", token, body: input });
  }

  async getAgentPayServiceQuote(): Promise<AgentPayServiceQuote> {
    const resolved = await this.request<{ packageHash: string; network: string }>(
      {
        path: "/resolve",
        method: "GET",
        query: { symbol: "WCSPR" }
      },
      this.serviceBaseUrl
    );
    if (
      !resolved ||
      typeof resolved.packageHash !== "string" ||
      !CASPER_PACKAGE_HASH.test(resolved.packageHash) ||
      resolved.network !== "casper-mainnet"
    ) {
      throw new AuditApiError({
        code: "invalid_token_resolution",
        message: "CSPR.trade returned an invalid WCSPR package hash or network.",
        status: 502,
        retryable: true
      });
    }
    const quote = await this.request<AgentPayServiceQuote>(
      {
        path: "/reports/quote",
        method: "GET",
        query: { subject: resolved.packageHash, network: resolved.network }
      },
      this.serviceBaseUrl
    );
    if (
      quote.paymentReadiness?.status !== "ready" ||
      !Array.isArray(quote.paymentRequirements) ||
      quote.paymentRequirements.length === 0
    ) {
      throw new AuditApiError({
        code: "service_charge_unavailable",
        message: "AgentPay's own charge is unavailable because its Testnet payment service is not ready. Try again shortly.",
        status: 503,
        retryable: true,
        field: "paymentReadiness.status",
        expected: "ready",
        received: quote.paymentReadiness?.status ?? "missing"
      });
    }
    return quote;
  }

  createCheck(token: string, body: CreateCheckBody, idempotencyKey: string): Promise<CheckPaymentResult> {
    return this.request<CheckPaymentResult>({
      path: "/v1/checks",
      method: "POST",
      token,
      headers: { "idempotency-key": idempotencyKey },
      body
    });
  }

  getCheck(token: string, checkId: string): Promise<{ check: PaymentCheck }> {
    return this.request({ path: `/v1/checks/${encodeURIComponent(checkId)}`, method: "GET", token });
  }

  cancelCheck(token: string, checkId: string): Promise<{ check: PaymentCheck }> {
    return this.request({ path: `/v1/checks/${encodeURIComponent(checkId)}/cancel`, method: "POST", token });
  }

  verifySettlement(token: string, checkId: string, transactionHash: string): Promise<VerifySettlementResult> {
    return this.request<VerifySettlementResult>({
      path: `/v1/checks/${encodeURIComponent(checkId)}/verify-settlement`,
      method: "POST",
      token,
      body: { transactionHash }
    });
  }

  recordObservation(token: string, checkId: string, observation: ResponseObservationInput): Promise<ObservationResult> {
    return this.request<ObservationResult>({
      path: `/v1/checks/${encodeURIComponent(checkId)}/response-observations`,
      method: "POST",
      token,
      body: observation
    });
  }

  getReceiptRecord(token: string, receiptId: string): Promise<PaymentReceiptRecord> {
    return this.request<PaymentReceiptRecord>({
      path: `/v1/receipts/${encodeURIComponent(receiptId)}`,
      method: "GET",
      token
    });
  }

  // Operator-only read; agents receive 403 operator_session_required. Works
  // in-browser with a pasted operator session token.
  listProviderDecisions(token: string): Promise<{ decisions: ProviderDecision[] }> {
    return this.request({ path: "/v1/provider-decisions", method: "GET", token });
  }

  // Saves a provider rule after an origin-bound action challenge is signed by
  // the same Casper account as the current operator session.
  createProviderDecision(
    token: string,
    input: { challengeId: string; decision: ProviderDecision }
  ): Promise<{ decision: ProviderDecision }> {
    return this.request({ path: "/v1/provider-decisions", method: "POST", token, body: input });
  }

  private async request<T>(input: RequestInput, baseUrl: string = this.baseUrl): Promise<T> {
    const url = new URL(`${baseUrl}${input.path}`, window.location.origin);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);

    const headers = new Headers(input.headers);
    if (input.token) headers.set("authorization", `Bearer ${input.token}`);
    if (input.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      throw new AuditApiError({
        code: timedOut ? "request_timeout" : "network_error",
        message: timedOut
          ? "AgentPay did not respond before the request timed out."
          : "AgentPay could not be reached. Check that the report API is running.",
        status: 0,
        retryable: true
      });
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AuditApiError({
          code: "malformed_response",
          message: "AgentPay returned a response that was not valid JSON.",
          status: response.status
        });
      }
    }

    if (!response.ok) throw toApiError(parsed, response.status);
    if (response.status === 204) return null as T;
    return parsed as T;
  }
}

function toApiError(body: unknown, status: number): AuditApiError {
  const record = asRecord(body);
  return new AuditApiError({
    code:
      typeof record?.code === "string"
        ? record.code
        : typeof record?.error === "string"
          ? record.error
          : "request_failed",
    message:
      typeof record?.message === "string"
        ? record.message
        : typeof record?.reason === "string"
          ? record.reason
          : "AgentPay rejected the request.",
    status,
    retryable: record?.retryable === true,
    field: typeof record?.field === "string" ? record.field : null,
    expected: record?.expected ?? null,
    received: record?.received ?? null
  });
}

// The /v1/probes result exposes the normalized `terms`, not the raw x402
// PAYMENT-REQUIRED object POST /v1/checks re-normalizes. Reconstruct a faithful
// single-acceptance paymentRequired from the probed terms so probe → check does
// not depend on a second probe; the server recomputes the requirement hash from
// this exact content.
export function paymentRequiredFromTerms(terms: PaymentTerms): {
  x402Version: 2;
  accepts: PaymentRequirement[];
  resource: PaymentTerms["resource"];
} {
  const accept: PaymentRequirement = {
    scheme: terms.scheme,
    network: terms.network,
    asset: terms.asset,
    amount: terms.amount,
    payTo: terms.payTo,
    maxTimeoutSeconds: terms.maxTimeoutSeconds,
    extra: terms.extra
  };
  return { x402Version: 2, accepts: [accept], resource: terms.resource };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Commands copied out of the browser need an absolute URL even when the web
// client itself uses the same-origin /api route.
export const auditApiBase = publicEndpoint(REPORT_API_BASE);
