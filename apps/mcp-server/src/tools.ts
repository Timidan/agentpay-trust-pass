import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuthorizationIntent, EvidenceRecord, OriginalRequestInput, ProofStep } from "@agent-pay/core";
import {
  buyReport,
  createPaymentAuditClient,
  getPaymentStatus,
  getQuote,
  verifyReport
} from "./apiClient.js";
import { getRegistryStatus, recordAgentPayDecision } from "./casperClient.js";
import { ToolConfigError, ToolInputError } from "./errors.js";
import { assessSubject, type Verdict } from "./trust/assess.js";
import { narrateVerdict } from "./trust/narrator.js";
import { buildX402PaymentSignature, loadSignerFromPem } from "./trust/x402Signer.js";

const DEFAULT_REPORT_API_URL = "http://127.0.0.1:4021";

function resolveReportApiUrl(inputUrl?: string) {
  if (inputUrl && process.env.AGENT_PAY_ALLOW_REPORT_API_URL_OVERRIDE !== "0") {
    return inputUrl;
  }
  return process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL;
}

function resolvePaymentAuditApiUrl(inputUrl?: string): string {
  if (inputUrl && process.env.AGENT_PAY_ALLOW_REPORT_API_URL_OVERRIDE !== "0") return inputUrl;
  return process.env.AGENT_PAY_API_URL ?? process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL;
}

function paymentAuditClient(inputUrl?: string) {
  const token = process.env.AGENT_PAY_API_TOKEN;
  if (!token) throw new ToolConfigError("AGENT_PAY_API_TOKEN is required for payment audit tools");
  try {
    return createPaymentAuditClient(resolvePaymentAuditApiUrl(inputUrl), token);
  } catch {
    throw new ToolConfigError("AGENT_PAY_API_URL or AGENT_PAY_API_TOKEN is invalid");
  }
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
      "Quote an x402 price for an AgentPay report scoped to a subject: a token package hash (64 hex / hash-<64 hex>) or a Casper account (account-hash-<64 hex> / public key). Returns price, expiry, dataset root, payment resource, and x402 requirements for that subject's live evidence.",
    inputSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: {
          type: "string",
          description: "Token package hash (64 hex / hash-<64 hex>) or account (account-hash-<64 hex> or public key 01…/02…)"
        },
        reportApiUrl: { type: "string" }
      }
    }
  },
  {
    name: "payment_status",
    description: "Check whether AgentPay's configured Casper x402 facilitator path is ready to accept payment.",
    inputSchema: { type: "object", properties: { reportApiUrl: { type: "string" } } }
  },
  {
    name: "registry_status",
    description: "Check whether AgentPay's Casper registry recording path is configured and reachable.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "buy_report",
    description: "Buy the evidence report with an x402 payment payload.",
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
    description: "Verify the report Merkle proof against the dataset root.",
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
    description: "Record an AgentPay trust decision through the Casper boundary.",
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
      "Full Trust Signal rail: quotes evidence, pays x402, verifies Merkle proofs, scores deterministically, narrates, and stamps the verdict on Casper. Accepts a token package hash OR a Casper account (account-hash-<64 hex> / public key) and routes to the matching policy. Returns a Verdict.",
    inputSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: {
          type: "string",
          description: "Token package hash (64 hex / hash-<64 hex>) or account (account-hash-<64 hex> or public key 01…/02…)"
        },
        reportApiUrl: { type: "string" }
      }
    }
  },
  {
    name: "assess_account",
    description:
      "Counterparty check: the full rail scoped to a Casper account (existence, CSPR balance, multisig control and age), scored against the account policy and stamped on Casper. Returns a Verdict.",
    inputSchema: {
      type: "object",
      required: ["account"],
      properties: {
        account: { type: "string", description: "account-hash-<64 hex> or a public key (01…/02…)" },
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
    description: "Get the independently verifiable receipt and its current Casper anchor status.",
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

export async function quoteReportTool(input: { reportApiUrl?: string; subject?: string } = {}) {
  const subject = input.subject?.trim();
  if (!subject) {
    throw new ToolInputError("quote_report requires a subject (token package hash or Casper account)");
  }
  return getQuote(resolveReportApiUrl(input.reportApiUrl), subject);
}

export async function paymentStatusTool(input: { reportApiUrl?: string } = {}) {
  return getPaymentStatus(resolveReportApiUrl(input.reportApiUrl));
}

export async function registryStatusTool() {
  return getRegistryStatus();
}

export async function buyReportTool(input: {
  reportApiUrl?: string;
  quoteId: string;
  paymentPayload?: unknown;
}) {
  return buyReport({
    reportApiUrl: resolveReportApiUrl(input.reportApiUrl),
    quoteId: input.quoteId,
    paymentPayload: input.paymentPayload
  });
}

export async function verifyReportTool(input: {
  reportApiUrl?: string;
  record: EvidenceRecord;
  proof: ProofStep[];
  datasetRoot: string;
}) {
  return verifyReport({
    reportApiUrl: resolveReportApiUrl(input.reportApiUrl),
    record: input.record,
    proof: input.proof,
    datasetRoot: input.datasetRoot
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
}): Promise<Verdict> {
  const reportApiUrl = resolveReportApiUrl(input.reportApiUrl);

  return assessSubject({ subject: input.subject, reportApiUrl }, {
    quote: async (subject: string) =>
      getQuote(reportApiUrl, subject),

    settle: async ({ quote }: { quote: any }) => {
      const secretKeyPath = process.env.CASPER_SECRET_KEY_PATH;
      if (!secretKeyPath) {
        throw new ToolConfigError("CASPER_SECRET_KEY_PATH is required for assess_subject");
      }
      let pem: string;
      try {
        pem = await readFile(resolve(process.cwd(), secretKeyPath), "utf8");
      } catch {
        throw new ToolConfigError("CASPER_SECRET_KEY_PATH points to a missing or unreadable key file");
      }
      let signer: ReturnType<typeof loadSignerFromPem>;
      try {
        signer = loadSignerFromPem(pem);
      } catch {
        throw new ToolConfigError("CASPER_SECRET_KEY_PATH does not contain a valid Casper secret key");
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
}

/** Counterparty check — the same rail, entered with an account identifier. */
export async function assessAccountTool(input: {
  account: string;
  reportApiUrl?: string;
}): Promise<Verdict> {
  return assessSubjectTool({ subject: normalizeAccountInput(input.account), reportApiUrl: input.reportApiUrl });
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
