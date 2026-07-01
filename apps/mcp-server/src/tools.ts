import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EvidenceRecord, ProofStep } from "@agent-pay/core";
import { buyReport, getPaymentStatus, getQuote, verifyReport } from "./apiClient.js";
import { getRegistryStatus, recordAgentPayDecision } from "./casperClient.js";
import { assessSubject, type Verdict } from "./trust/assess.js";
import { narrateVerdict } from "./trust/narrator.js";
import { buildX402PaymentSignature, loadSignerFromPem } from "./trust/x402Signer.js";

const DEFAULT_REPORT_API_URL = "http://127.0.0.1:4021";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "quote_report",
    description: "Quote an x402 price for an AgentPay report built from live Casper product evidence.",
    inputSchema: { type: "object", properties: { reportApiUrl: { type: "string" } } }
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
      "Full Trust Signal rail: quotes evidence, pays x402, verifies Merkle proofs, scores deterministically, narrates, and stamps the verdict on Casper. Returns a Verdict.",
    inputSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: { type: "string", description: "Casper package hash (64 hex chars or hash-<64 hex>)" },
        reportApiUrl: { type: "string" }
      }
    }
  }
];

export async function quoteReportTool(input: { reportApiUrl?: string } = {}) {
  return getQuote(input.reportApiUrl ?? process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL);
}

export async function paymentStatusTool(input: { reportApiUrl?: string } = {}) {
  return getPaymentStatus(input.reportApiUrl ?? process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL);
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
    reportApiUrl: input.reportApiUrl ?? process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL,
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
    reportApiUrl: input.reportApiUrl ?? process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL,
    record: input.record,
    proof: input.proof,
    datasetRoot: input.datasetRoot
  });
}

export async function recordDecisionTool(input: {
  datasetId: string;
  datasetRoot: string;
  reportHash: string;
  paymentReceiptHash: string;
  decision: "approved" | "rejected" | "needs_review";
}) {
  return recordAgentPayDecision(input);
}

export async function assessSubjectTool(input: {
  subject: string;
  reportApiUrl?: string;
}): Promise<Verdict> {
  const reportApiUrl =
    input.reportApiUrl ?? process.env.REPORT_API_URL ?? DEFAULT_REPORT_API_URL;

  return assessSubject({ subject: input.subject, reportApiUrl }, {
    quote: async (subject: string) =>
      getQuote(reportApiUrl, subject),

    settle: async ({ quote }: { quote: any }) => {
      const secretKeyPath = process.env.CASPER_SECRET_KEY_PATH;
      if (!secretKeyPath) {
        throw new Error("CASPER_SECRET_KEY_PATH is required for assess_subject");
      }
      const pem = await readFile(resolve(process.cwd(), secretKeyPath), "utf8");
      const signer = loadSignerFromPem(pem);
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
