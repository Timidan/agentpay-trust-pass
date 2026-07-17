import { bridgeApiBase, publicEndpoint, reportApiBase } from "./runtime-origins";

export type EvidenceFactValue = string | number | boolean | null;

export type EvidenceRecord = {
  id: string;
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  facts: Record<string, EvidenceFactValue>;
  rawHash: string;
};

export type ReportProof = {
  datasetId: string;
  record: EvidenceRecord;
  reportHash: string;
  proof: ProofStep[];
};

export type ProofStep = {
  position: "left" | "right";
  hash: string;
};

export type Quote = {
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

export type SourceSummary = {
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  recordHash: string;
  facts: Record<string, EvidenceFactValue>;
};

export type PaymentRequirement = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  maxTimeoutSeconds: number;
  payTo: string;
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

export type PaidReport = {
  datasetId: string;
  datasetRoot: string;
  evidenceNetwork: EvidenceNetwork;
  reportId: string;
  report: EvidenceRecord;
  reportHash: string;
  proof: ProofStep[];
  evidence?: ReportProof[];
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

export type Verification = {
  verified: boolean;
};

export type DecisionReceipt = {
  mode: "submitted";
  txHash: string;
  hashKind: "transaction" | "deploy";
  confirmation: {
    rpcUrl: string;
    method: "info_get_transaction" | "info_get_deploy";
    apiVersion: string | null;
    executionState: "executed" | "pending" | "unknown";
    blockHash: string | null;
    attempts: number;
    observedAt: string;
  };
  input: {
    datasetId: string;
    datasetRoot: string;
    reportHash: string;
    paymentReceiptHash: string;
    decision: "approved" | "rejected" | "needs_review";
  };
};

export type RegistryStatusCheck = {
  name: string;
  status: "pass" | "fail" | "missing";
  message: string;
};

export type RegistryStatus = {
  status: "ready" | "configuration_required" | "rpc_unavailable";
  reason: string | null;
  checkedAt: string;
  checks: RegistryStatusCheck[];
  registryPackageHash: string | null;
  rpc: {
    apiVersion: string | null;
    chainspecName: string | null;
    latestBlockHeight: number | null;
    latestBlockHash: string | null;
  } | null;
  receiptAnchors?: {
    status: "ready" | "configuration_required";
    reason: string | null;
    contractHash: string | null;
  };
};

const MCP_URL = bridgeApiBase;
export const bridgeUrl = publicEndpoint(MCP_URL);
export const reportApiOrigin = publicEndpoint(reportApiBase);

export type BridgeActivityEntry = {
  tool: string;
  status: number;
  ms: number;
  at: string;
};

export type TokenEvidenceStatus = {
  status: "complete" | "limited";
  source: "CSPR.live + Casper RPC" | "CSPR.cloud" | "Casper RPC";
  available: string[];
  unavailable: string[];
};

export type ReportHealth = {
  ok: boolean;
  service: "report-api";
  checkedAt: string;
  tokenEvidence: TokenEvidenceStatus;
};

/** Real agent traffic seen by the MCP HTTP bridge, newest first. */
export async function getBridgeActivity(): Promise<{ entries: BridgeActivityEntry[] }> {
  const response = await fetch(`${MCP_URL}/activity`);
  if (!response.ok) {
    throw new Error(`Failed to fetch bridge activity: ${response.status}`);
  }
  return response.json() as Promise<{ entries: BridgeActivityEntry[] }>;
}

export async function getBridgeHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${MCP_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function getReportHealth(): Promise<ReportHealth | null> {
  try {
    const response = await fetch(`${reportApiBase}/health`);
    if (!response.ok) return null;
    const body = await response.json() as Partial<ReportHealth>;
    if (
      body.service !== "report-api" ||
      (body.tokenEvidence?.status !== "complete" && body.tokenEvidence?.status !== "limited")
    ) {
      return null;
    }
    return body as ReportHealth;
  } catch {
    return null;
  }
}

export type FeedEntry = {
  id: string;
  aspect: string;
  subjectShortHash: string;
  cardImageUrl: string;
};

export type VerdictPublicationProof = {
  hashKind: "transaction" | "deploy";
  datasetId: string;
  datasetRoot: string;
  reportHash: string;
  paymentReceiptHash: string;
  verdictReport: Record<string, unknown>;
};

export type VerdictCardData = {
  aspect: string;
  subjectShortHash: string;
  flags: { code: string; message: string }[];
  notChecked: string[];
  decisionTxHash: string;
  policyHash: string;
};

export async function storeVerdictCard(data: {
  card: VerdictCardData;
  proof: VerdictPublicationProof;
}): Promise<{ id: string }> {
  const response = await fetch(`${reportApiBase}/card`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    await throwReportApiError(response, "AgentPay could not create the share card.");
  }
  return response.json() as Promise<{ id: string }>;
}

export async function shareVerdict(cardId: string, optIn: boolean): Promise<{ ok: boolean }> {
  const response = await fetch(`${reportApiBase}/feed/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId, optIn })
  });
  if (!response.ok) {
    await throwReportApiError(response, "AgentPay could not publish this check.");
  }
  return response.json() as Promise<{ ok: boolean }>;
}

/** Resolve server-relative card paths against the public report API. */
export function absoluteCardImageUrl(cardImageUrl: string): string {
  if (/^https?:\/\//i.test(cardImageUrl)) {
    return cardImageUrl;
  }
  return `${reportApiOrigin}${cardImageUrl.startsWith("/") ? "" : "/"}${cardImageUrl}`;
}

export async function getFeed(): Promise<{ entries: FeedEntry[] }> {
  const response = await fetch(`${reportApiBase}/feed`);
  if (!response.ok) {
    await throwReportApiError(response, "AgentPay could not load shared checks.");
  }
  const body = (await response.json()) as { entries: FeedEntry[] };
  return {
    entries: (body?.entries ?? []).map((entry) => ({
      ...entry,
      cardImageUrl: absoluteCardImageUrl(entry.cardImageUrl)
    }))
  };
}

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

export type EvidenceNetwork = "casper-mainnet" | "casper-testnet";

/** Resolves a token symbol to its package hash within cspr.trade's pair set. */
export async function resolveToken(symbol: string): Promise<ResolvedToken | null> {
  const response = await fetch(`${reportApiBase}/resolve?symbol=${encodeURIComponent(symbol)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    await throwReportApiError(response, "AgentPay could not look up that token symbol.");
  }
  return response.json() as Promise<ResolvedToken>;
}

export function buildShareLink(cardId: string): string {
  return `${reportApiOrigin}/card/${encodeURIComponent(cardId)}.png`;
}

const DEFAULT_TOOL_TIMEOUT_MS = 45_000;
const CHAIN_TOOL_TIMEOUT_MS = 180_000;
const CHAIN_TOOLS = new Set([
  "assess_account",
  "assess_subject",
  "buy_report",
  "record_decision"
]);

export function toolTimeoutMs(tool: string): number {
  return CHAIN_TOOLS.has(tool) ? CHAIN_TOOL_TIMEOUT_MS : DEFAULT_TOOL_TIMEOUT_MS;
}

export async function callTool<T>(tool: string, payload: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), toolTimeoutMs(tool));
  try {
    // The timeout must cover the body read too: a server can send headers then
    // stall the JSON stream, so clearing the timer before .json() would hang.
    const response = await fetch(`${MCP_URL}/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    // Read as text first: a non-JSON body (proxy HTML, 502, empty) would make
    // .json() throw a raw SyntaxError that leaks to the user. Parse defensively.
    const raw = await response.text();
    let body: { message?: string; reason?: string } | null = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      throw new ToolCallError(
        "AgentPay returned an unexpected response. Check that its services are running, then try again.",
        response.status,
        null
      );
    }
    if (!response.ok) {
      throw new ToolCallError(body?.message ?? body?.reason ?? `Tool ${tool} failed`, response.status, body);
    }
    return body as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ToolCallError("The check timed out before Casper responded. Try again.", 504, null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class ToolCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

async function throwReportApiError(response: Response, fallback: string): Promise<never> {
  let body: { code?: string; error?: string; message?: string } | null = null;
  try {
    body = await response.json() as { code?: string; error?: string; message?: string };
  } catch {
    // The fallback remains safe when a proxy returns HTML or an empty body.
  }
  throw new ToolCallError(body?.message ?? fallback, response.status, body);
}

export type Verdict = {
  aspect: "CLEAR" | "CAUTION" | "DANGER";
  decision: "approved" | "needs_review" | "rejected";
  flags: { code: string; severity: "danger" | "caution"; message: string }[];
  notChecked: string[];
  passed: string[];
  rationale: string;
  notCheckedNote: string;
  subject: { kind: string; packageHash: string; raw: string };
  evidenceNetwork: EvidenceNetwork;
  resolvedToken?: ResolvedToken & { source: "CSPR.trade" };
  resolvedAccount?: ResolvedCsprName;
  payment: {
    amount: string;
    amountDisplay: string;
    asset: string;
    assetSymbol: string;
    assetDecimals: number | null;
    network: string;
  };
  paymentReceiptHash: string;
  settlementTxHash: string;
  decisionTxHash: string;
  datasetRoot: string;
  policyHash: string;
  publicationProof: VerdictPublicationProof;
  settlementExplorerUrl: string;
  explorerUrl: string;
};

export async function assessSubject(
  subject: string,
  evidenceNetwork: EvidenceNetwork
): Promise<Verdict> {
  return callTool<Verdict>("assess_subject", { subject, evidenceNetwork });
}

/** Paid check scoped to a Casper account hash or public key. */
export async function assessAccount(
  account: string,
  evidenceNetwork: EvidenceNetwork
): Promise<Verdict> {
  return callTool<Verdict>("assess_account", { account, evidenceNetwork });
}
