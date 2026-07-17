import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseSubject,
  type AuthorizationIntent,
  type EvidenceRecord,
  type OriginalRequestInput,
  type ProofStep
} from "@agent-pay/core";
import {
  buyReport,
  createPaymentAuditClient,
  getPaymentStatus,
  getQuote,
  resolveCsprName,
  resolveToken,
  verifyReport,
  type EvidenceNetwork,
  type ResolvedCsprName,
  type ResolvedToken
} from "./apiClient.js";
import { getRegistryStatus, recordAgentPayDecision } from "./casperClient.js";
import { ToolConfigError, ToolInputError } from "./errors.js";
import { assessSubject, type Verdict } from "./trust/assess.js";
import { narrateVerdict } from "./trust/narrator.js";
import { buildX402PaymentSignature, loadSignerFromPem } from "./trust/x402Signer.js";

const DEFAULT_REPORT_API_URL = "http://127.0.0.1:4021";

function resolveReportApiUrl(inputUrl?: string): string {
  return resolveBackendUrl(inputUrl, configuredReportApiUrl());
}

function resolvePaymentAuditApiUrl(inputUrl?: string): string {
  return resolveBackendUrl(
    inputUrl,
    process.env.AGENT_PAY_API_URL ?? configuredReportApiUrl()
  );
}

export function configuredReportApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.REPORT_API_URL?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new ToolConfigError("REPORT_API_URL is required in production");
  }
  return DEFAULT_REPORT_API_URL;
}

function paymentAuditClient(inputUrl?: string) {
  const token = process.env.AGENT_PAY_API_TOKEN;
  if (!token) throw new ToolConfigError("AGENT_PAY_API_TOKEN is required for payment audit tools");
  const baseUrl = resolvePaymentAuditApiUrl(inputUrl);
  try {
    return createPaymentAuditClient(baseUrl, token);
  } catch {
    throw new ToolConfigError("AGENT_PAY_API_URL or AGENT_PAY_API_TOKEN is invalid");
  }
}

function resolveBackendUrl(inputUrl: string | undefined, configuredUrl: string): string {
  const configured = normalizeBackendUrl(configuredUrl, "configured AgentPay API URL", true);
  if (!inputUrl) return configured;

  const requested = normalizeBackendUrl(inputUrl, "tool API URL", false);
  if (requested === configured) return configured;
  if (process.env.AGENT_PAY_ALLOW_REPORT_API_URL_OVERRIDE !== "1") {
    throw new ToolInputError("Per-call AgentPay API URL overrides are disabled");
  }

  const allowed = new Set(
    (process.env.AGENT_PAY_ALLOWED_REPORT_API_URLS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => normalizeBackendUrl(value, "AGENT_PAY_ALLOWED_REPORT_API_URLS entry", true))
  );
  if (!allowed.has(requested)) {
    throw new ToolInputError("Per-call AgentPay API URL is not in AGENT_PAY_ALLOWED_REPORT_API_URLS allowlist");
  }
  return requested;
}

function normalizeBackendUrl(value: string, label: string, configuration: boolean): string {
  const fail = (message: string): never => {
    if (configuration) throw new ToolConfigError(message);
    throw new ToolInputError(message);
  };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(`${label} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return fail(`${label} must use HTTP or HTTPS`);
  }
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    return fail(`${label} must use HTTPS outside localhost`);
  }
  if (url.username || url.password || url.search || url.hash) {
    return fail(`${label} must not include credentials, query parameters, or a fragment`);
  }
  return url.toString().replace(/\/+$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "quote_report",
    description:
      "Get the price and payment terms for a live AgentPay check of a Casper token or account.",
    inputSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: {
          type: "string",
          description: "CSPR.trade token symbol, token package hash, CSPR.name, Casper account hash, or Casper public key"
        },
        evidenceNetwork: {
          enum: ["casper-mainnet", "casper-testnet"],
          description: "Casper network to inspect. This is separate from the x402 payment network."
        },
        reportApiUrl: { type: "string" }
      }
    }
  },
  {
    name: "payment_status",
    description: "Check whether AgentPay can settle the Testnet fee for a paid token or account check.",
    inputSchema: { type: "object", properties: { reportApiUrl: { type: "string" } } }
  },
  {
    name: "registry_status",
    description: "Check whether AgentPay can record check results and receipt hashes in its Casper Testnet registry.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "buy_report",
    description: "Submit a signed x402 payment for a quoted check and receive the checked Casper data.",
    inputSchema: {
      type: "object",
      required: ["quoteId"],
      properties: {
        reportApiUrl: { type: "string" },
        quoteId: { type: "string" },
        paymentPayload: { oneOf: [{ type: "object" }, { type: "string" }] }
      }
    }
  },
  {
    name: "verify_report",
    description: "Confirm that returned Casper data belongs to the paid report by checking its Merkle proof.",
    inputSchema: {
      type: "object",
      required: ["record", "proof", "datasetRoot"],
      properties: {
        reportApiUrl: { type: "string" },
        record: { type: "object" },
        proof: { type: "array" },
        datasetRoot: { type: "string" }
      }
    }
  },
  {
    name: "record_decision",
    description: "Write an already verified check result to AgentPay's Casper Testnet registry.",
    inputSchema: {
      type: "object",
      required: ["datasetId", "datasetRoot", "reportHash", "paymentReceiptHash", "decision"],
      properties: {
        datasetId: { type: "string" },
        datasetRoot: { type: "string" },
        reportHash: { type: "string" },
        paymentReceiptHash: { type: "string" },
        decision: { enum: ["approved", "rejected", "needs_review"] }
      }
    }
  },
  {
    name: "assess_subject",
    description:
      "Run the complete paid check for a Casper token or account: resolve it, read live data, pay over x402, verify the data, apply fixed rules, and record the result on Casper Testnet.",
    inputSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: {
          type: "string",
          description: "CSPR.trade token symbol, token package hash, CSPR.name, Casper account hash, or Casper public key"
        },
        evidenceNetwork: {
          enum: ["casper-mainnet", "casper-testnet"],
          description: "Casper network to inspect. The check payment and verdict record remain on Testnet."
        },
        reportApiUrl: { type: "string" }
      }
    }
  },
  {
    name: "assess_account",
    description:
      "Check a Casper account's existence, CSPR balance, associated keys, and action thresholds, then record the result on Casper Testnet.",
    inputSchema: {
      type: "object",
      required: ["account"],
      properties: {
        account: { type: "string", description: "CSPR.name, account-hash-<64 hex>, or a public key (01…/02…)" },
        evidenceNetwork: {
          enum: ["casper-mainnet", "casper-testnet"],
          description: "Casper network to inspect. The check payment and verdict record remain on Testnet."
        },
        reportApiUrl: { type: "string" }
      }
    }
  },
  {
    name: "check_x402_payment",
    description: "Check x402 terms and an unsigned Casper authorization before payment. Returns PAY, REVIEW, or BLOCK.",
    inputSchema: {
      type: "object",
      required: ["request", "paymentRequired", "authorization"],
      properties: {
        agentPayApiUrl: { type: "string" },
        request: { type: "object" },
        paymentRequired: { type: "object" },
        authorization: { type: "object" },
        idempotencyKey: { type: "string" }
      }
    }
  },
  {
    name: "verify_x402_settlement",
    description: "Verify that a Casper transaction settled the exact payment AgentPay approved.",
    inputSchema: {
      type: "object",
      required: ["checkId", "transactionHash"],
      properties: {
        agentPayApiUrl: { type: "string" },
        checkId: { type: "string" },
        transactionHash: { type: "string" }
      }
    }
  },
  {
    name: "get_payment_receipt",
    description: "Get a payment receipt and confirm whether its hash is recorded in AgentPay's Casper registry.",
    inputSchema: {
      type: "object",
      required: ["receiptId"],
      properties: {
        agentPayApiUrl: { type: "string" },
        receiptId: { type: "string" }
      }
    }
  }
];

export async function quoteReportTool(input: {
  reportApiUrl?: string;
  subject?: string;
  evidenceNetwork?: EvidenceNetwork;
} = {}) {
  if (!isRecord(input)) throw new ToolInputError("quote_report input must be an object");
  const subject = nonEmptyString(
    input.subject,
    "quote_report requires subject: a CSPR.trade symbol, token package hash, CSPR.name, account hash, or Casper public key"
  );
  const reportApiUrl = resolveReportApiUrl(
    optionalString(input.reportApiUrl, "quote_report reportApiUrl")
  );
  const resolved = await resolveCheckSubject(
    reportApiUrl,
    subject,
    optionalEvidenceNetwork(input.evidenceNetwork, "quote_report evidenceNetwork")
  );
  const quote = await getQuote(
    reportApiUrl,
    resolved.subject,
    resolved.evidenceNetwork
  );
  return withResolution(quote, resolved);
}

export async function paymentStatusTool(input: { reportApiUrl?: string } = {}) {
  if (!isRecord(input)) throw new ToolInputError("payment_status input must be an object");
  return getPaymentStatus(
    resolveReportApiUrl(optionalString(input.reportApiUrl, "payment_status reportApiUrl"))
  );
}

export async function registryStatusTool() {
  return getRegistryStatus();
}

export async function buyReportTool(input: {
  reportApiUrl?: string;
  quoteId: string;
  paymentPayload?: unknown;
}) {
  if (!isRecord(input)) throw new ToolInputError("buy_report input must be an object");
  const quoteId = nonEmptyString(input.quoteId, "buy_report requires quoteId");
  return buyReport({
    reportApiUrl: resolveReportApiUrl(optionalString(input.reportApiUrl, "buy_report reportApiUrl")),
    quoteId,
    paymentPayload: input.paymentPayload
  });
}

export async function verifyReportTool(input: {
  reportApiUrl?: string;
  record: EvidenceRecord;
  proof: ProofStep[];
  datasetRoot: string;
}) {
  if (!isRecord(input)) throw new ToolInputError("verify_report input must be an object");
  if (!isRecord(input.record)) throw new ToolInputError("verify_report requires record");
  if (!Array.isArray(input.proof)) throw new ToolInputError("verify_report requires proof");
  const datasetRoot = nonEmptyString(input.datasetRoot, "verify_report requires datasetRoot");
  if (!/^[0-9a-f]{64}$/i.test(datasetRoot)) {
    throw new ToolInputError("verify_report datasetRoot must be 64 hexadecimal characters");
  }
  return verifyReport({
    reportApiUrl: resolveReportApiUrl(optionalString(input.reportApiUrl, "verify_report reportApiUrl")),
    record: input.record as EvidenceRecord,
    proof: input.proof,
    datasetRoot: datasetRoot.toLowerCase()
  });
}

export async function checkX402PaymentTool(input: {
  agentPayApiUrl?: string;
  request: OriginalRequestInput;
  paymentRequired: unknown;
  authorization: AuthorizationIntent;
  idempotencyKey?: string;
}) {
  if (!isRecord(input?.request)) throw new ToolInputError("check_x402_payment requires request");
  if (!isRecord(input?.paymentRequired)) throw new ToolInputError("check_x402_payment requires paymentRequired");
  if (!isRecord(input?.authorization)) throw new ToolInputError("check_x402_payment requires authorization");
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  return paymentAuditClient(input.agentPayApiUrl).check({
    request: input.request,
    paymentRequired: input.paymentRequired,
    authorization: input.authorization,
    idempotencyKey
  });
}

export async function verifyX402SettlementTool(input: {
  agentPayApiUrl?: string;
  checkId: string;
  transactionHash: string;
}) {
  const checkId = nonEmptyString(input?.checkId, "verify_x402_settlement requires checkId");
  const transactionHash = nonEmptyString(
    input?.transactionHash,
    "verify_x402_settlement requires transactionHash"
  ).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(transactionHash)) {
    throw new ToolInputError("verify_x402_settlement transactionHash must be 64 hexadecimal characters");
  }
  return paymentAuditClient(input.agentPayApiUrl).verifySettlement(checkId, transactionHash);
}

export async function getPaymentReceiptTool(input: { agentPayApiUrl?: string; receiptId: string }) {
  const receiptId = nonEmptyString(input?.receiptId, "get_payment_receipt requires receiptId");
  return paymentAuditClient(input.agentPayApiUrl).getReceiptRecord(receiptId);
}

const RECORD_DECISIONS = new Set(["approved", "rejected", "needs_review"]);

export async function recordDecisionTool(input: {
  datasetId: string;
  datasetRoot: string;
  reportHash: string;
  paymentReceiptHash: string;
  decision: "approved" | "rejected" | "needs_review";
}) {
  for (const field of ["datasetId", "datasetRoot", "reportHash", "paymentReceiptHash"] as const) {
    if (typeof input?.[field] !== "string" || input[field].length === 0) {
      throw new ToolInputError(`record_decision requires a non-empty string ${field}`);
    }
  }
  if (!RECORD_DECISIONS.has(input?.decision)) {
    throw new ToolInputError("record_decision decision must be approved, rejected, or needs_review");
  }
  return recordAgentPayDecision(input);
}

export async function assessSubjectTool(input: {
  subject: string;
  reportApiUrl?: string;
  evidenceNetwork?: EvidenceNetwork;
}): Promise<Verdict> {
  if (!isRecord(input)) throw new ToolInputError("assess_subject input must be an object");
  const subject = nonEmptyString(
    input.subject,
    "assess_subject requires subject: a CSPR.trade symbol, token package hash, CSPR.name, account hash, or Casper public key"
  );
  const reportApiUrl = resolveReportApiUrl(
    optionalString(input.reportApiUrl, "assess_subject reportApiUrl")
  );
  const evidenceNetwork = optionalEvidenceNetwork(
    input.evidenceNetwork,
    "assess_subject evidenceNetwork"
  );
  const resolved = await resolveCheckSubject(
    reportApiUrl,
    subject,
    evidenceNetwork
  );

  const verdict = await assessSubject({
    subject: resolved.subject,
    reportApiUrl,
    evidenceNetwork: resolved.evidenceNetwork
  }, {
    quote: async (subject: string) =>
      getQuote(reportApiUrl, subject, resolved.evidenceNetwork),

    settle: async ({ quote }: { quote: any }) => {
      const secretKeyPath = process.env.CASPER_SECRET_KEY_PATH;
      if (!secretKeyPath) {
        throw new ToolConfigError(
          "CASPER_SECRET_KEY_PATH is required for assess_subject",
          "AgentPay isn't set up to run live checks yet. The operator still needs to configure its Testnet signer."
        );
      }
      let pem: string;
      try {
        pem = await readFile(resolve(process.cwd(), secretKeyPath), "utf8");
      } catch {
        throw new ToolConfigError(
          "CASPER_SECRET_KEY_PATH points to a missing or unreadable key file",
          "AgentPay isn't set up to run live checks yet. Its Testnet signer is unavailable."
        );
      }
      let signer: ReturnType<typeof loadSignerFromPem>;
      try {
        signer = loadSignerFromPem(pem);
      } catch {
        throw new ToolConfigError(
          "CASPER_SECRET_KEY_PATH does not contain a valid Casper secret key",
          "AgentPay isn't set up to run live checks yet. Its Testnet signer is invalid."
        );
      }
      const requirement = quote.paymentRequirements?.[0];
      if (!requirement) {
        throw new Error(`No x402 payment requirement in quote: ${JSON.stringify(quote)}`);
      }
      const { paymentPayload } = buildX402PaymentSignature({
        requirement,
        resource: quote.paymentResource,
        signer
      });
      return buyReport({
        reportApiUrl,
        quoteId: quote.quoteId,
        paymentPayload
      });
    },

    verify: async ({ record, proof, datasetRoot }: { record: any; proof: any; datasetRoot: string }) =>
      verifyReport({ reportApiUrl, record, proof, datasetRoot }),

    record: async (args: {
      datasetId: string;
      datasetRoot: string;
      reportHash: string;
      paymentReceiptHash: string;
      decision: string;
    }) =>
      recordAgentPayDecision({
        datasetId: args.datasetId,
        datasetRoot: args.datasetRoot,
        reportHash: args.reportHash,
        paymentReceiptHash: args.paymentReceiptHash,
        decision: args.decision as "approved" | "rejected" | "needs_review"
      }),

    narrate: async (args: {
      aspect: string;
      flags: { code: string; severity: string; message: string }[];
      notChecked: string[];
      signals: Record<string, unknown>;
    }) => narrateVerdict(args)
  });
  return withResolution(verdict, resolved);
}

/** Counterparty check — the same rail, entered with an account identifier. */
export async function assessAccountTool(input: {
  account: string;
  reportApiUrl?: string;
  evidenceNetwork?: EvidenceNetwork;
}): Promise<Verdict> {
  if (!isRecord(input)) throw new ToolInputError("assess_account input must be an object");
  const account = nonEmptyString(input.account, "assess_account requires account");
  return assessSubjectTool({
    subject: normalizeAccountInput(account),
    reportApiUrl: optionalString(input.reportApiUrl, "assess_account reportApiUrl"),
    evidenceNetwork: optionalEvidenceNetwork(
      input.evidenceNetwork,
      "assess_account evidenceNetwork"
    )
  });
}

/**
 * assess_account is contractually "this IS an account", so a bare 64-hex (the
 * common explorer/CLI form of an account hash) must not fall through to the
 * token rail. Coerce it to the account-hash form; leave prefixed hashes and
 * public keys untouched.
 */
function normalizeAccountInput(account: string): string {
  const raw = (account ?? "").trim();
  return /^[0-9a-f]{64}$/i.test(raw) ? `account-hash-${raw.toLowerCase()}` : raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ToolInputError(message);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalEvidenceNetwork(
  value: unknown,
  label: string
): EvidenceNetwork | undefined {
  if (value === undefined) return undefined;
  if (value !== "casper-mainnet" && value !== "casper-testnet") {
    throw new ToolInputError(`${label} must be casper-mainnet or casper-testnet`);
  }
  return value;
}

async function resolveCheckSubject(
  reportApiUrl: string,
  subject: string,
  requestedNetwork: EvidenceNetwork | undefined
): Promise<{
  subject: string;
  evidenceNetwork: EvidenceNetwork | undefined;
  resolvedToken?: ResolvedToken & { source: "CSPR.trade" };
  resolvedAccount?: ResolvedCsprName;
}> {
  if (/\.cspr$/i.test(subject.trim())) {
    if (requestedNetwork && requestedNetwork !== "casper-mainnet") {
      throw new ToolInputError("CSPR.name resolves on casper-mainnet, not casper-testnet");
    }
    const resolvedAccount = await resolveCsprName(reportApiUrl, subject);
    if (!resolvedAccount) {
      throw new ToolInputError(`${subject.trim().toLowerCase()} is not assigned on CSPR.name`);
    }
    return {
      subject: resolvedAccount.publicKey ?? resolvedAccount.accountHash,
      evidenceNetwork: "casper-mainnet",
      resolvedAccount
    };
  }
  const parsed = parseSubject(subject);
  if (parsed.ok) {
    return { subject, evidenceNetwork: requestedNetwork };
  }
  if (!/^[A-Za-z][A-Za-z0-9._]{0,15}$/.test(subject)) {
    throw new ToolInputError(`Invalid subject: ${parsed.error}`, "invalid_subject");
  }

  const token = await resolveToken(reportApiUrl, subject);
  if (requestedNetwork && requestedNetwork !== token.network) {
    throw new ToolInputError(
      `${token.symbol} is listed by CSPR.trade on casper-mainnet, not ${requestedNetwork}`
    );
  }
  return {
    subject: token.packageHash,
    evidenceNetwork: token.network,
    resolvedToken: { ...token, source: "CSPR.trade" }
  };
}

function withResolution<T extends object>(
  value: T,
  resolved: {
    resolvedToken?: ResolvedToken & { source: "CSPR.trade" };
    resolvedAccount?: ResolvedCsprName;
  }
): T & {
  resolvedToken?: ResolvedToken & { source: "CSPR.trade" };
  resolvedAccount?: ResolvedCsprName;
} {
  return {
    ...value,
    ...(resolved.resolvedToken ? { resolvedToken: resolved.resolvedToken } : {}),
    ...(resolved.resolvedAccount ? { resolvedAccount: resolved.resolvedAccount } : {})
  };
}
