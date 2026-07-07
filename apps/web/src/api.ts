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
  facilitatorUrl: string;
  checks: PaymentReadinessCheck[];
  supportedKind: {
    x402Version: number;
    scheme: string;
    network: string;
    feePayer: string | null;
  } | null;
};

export type PaidReport = {
  datasetId: string;
  datasetRoot: string;
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
  recordScript: string;
  rpc: {
    url: string;
    apiVersion: string | null;
    chainspecName: string | null;
    latestBlockHeight: number | null;
    latestBlockHash: string | null;
  } | null;
};

const MCP_URL = import.meta.env.VITE_MCP_SERVER_URL ?? "http://127.0.0.1:3001";
const reportApiBase = import.meta.env.VITE_REPORT_API_URL ?? "http://127.0.0.1:4021";
export const voteUrl = import.meta.env.VITE_CSPR_FANS_VOTE_URL ?? "https://cspr.fans";
export const bridgeUrl = MCP_URL;

export type BridgeActivityEntry = {
  tool: string;
  status: number;
  ms: number;
  at: string;
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

export type FeedEntry = {
  id: string;
  aspect: string;
  subjectShortHash: string;
  cardImageUrl: string;
};

export async function storeVerdictCard(data: {
  aspect: string;
  subjectShortHash: string;
  flags: { code: string; message: string }[];
  notChecked: string[];
  decisionTxHash: string;
  policyHash: string;
}): Promise<{ id: string }> {
  const response = await fetch(`${reportApiBase}/card`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    throw new Error(`Failed to store card: ${response.status}`);
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
    throw new Error(`Failed to share verdict: ${response.status}`);
  }
  return response.json() as Promise<{ ok: boolean }>;
}

export async function getFeed(): Promise<{ entries: FeedEntry[] }> {
  const response = await fetch(`${reportApiBase}/feed`);
  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }
  return response.json() as Promise<{ entries: FeedEntry[] }>;
}

export type ResolvedToken = {
  symbol: string;
  packageHash: string;
  name: string | null;
  network: string;
};

/** Resolves a token symbol to its package hash within cspr.trade's pair set. */
export async function resolveToken(symbol: string): Promise<ResolvedToken | null> {
  const response = await fetch(`${reportApiBase}/resolve?symbol=${encodeURIComponent(symbol)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Symbol lookup failed: ${response.status}`);
  }
  return response.json() as Promise<ResolvedToken>;
}

export function buildShareLink(cardId: string): string {
  return `${voteUrl}?card=${encodeURIComponent(`${reportApiBase}/card/${cardId}.png`)}`;
}

// The full rail (quote → x402 → verify → record) legitimately takes ~10-20s,
// so the ceiling is generous — but bounded, so a hung backend surfaces a real
// error instead of an infinite spinner.
const TOOL_TIMEOUT_MS = 45_000;

export async function callTool<T>(tool: string, payload: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
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
        "The trust desk returned an unexpected response. Check that the AgentPay services are running, then try again.",
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

export type Verdict = {
  aspect: "CLEAR" | "CAUTION" | "DANGER";
  decision: "approved" | "needs_review" | "rejected";
  flags: { code: string; severity: "danger" | "caution"; message: string }[];
  notChecked: string[];
  passed: string[];
  rationale: string;
  notCheckedNote: string;
  subject: { kind: string; packageHash: string; raw: string };
  paymentReceiptHash: string;
  settlementTxHash: string;
  decisionTxHash: string;
  datasetRoot: string;
  policyHash: string;
  explorerUrl: string;
};

export async function assessSubject(subject: string): Promise<Verdict> {
  return callTool<Verdict>("assess_subject", { subject });
}

/** Counterparty check — the rail scoped to a Casper account (hash or public key). */
export async function assessAccount(account: string): Promise<Verdict> {
  return callTool<Verdict>("assess_account", { account });
}
