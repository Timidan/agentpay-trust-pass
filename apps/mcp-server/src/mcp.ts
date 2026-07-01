import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  assessSubjectTool,
  buyReportTool,
  paymentStatusTool,
  quoteReportTool,
  recordDecisionTool,
  registryStatusTool,
  verifyReportTool
} from "./tools.js";
import { AGENT_PAY_SKILL_URI, agentPaySkillMarkdown } from "./agentSkill.js";

const reportApiUrl = z.string().url().optional();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/i);

export function createAgentPayMcpServer() {
  const server = new McpServer({
    name: "agent-pay",
    version: "0.1.0"
  });

  server.registerResource(
    "agentpay-skill",
    AGENT_PAY_SKILL_URI,
    {
      title: "AgentPay Skill",
      description: "Machine-readable AgentPay Trust Signal integration contract.",
      mimeType: "text/markdown"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: agentPaySkillMarkdown()
        }
      ]
    })
  );

  server.registerTool(
    "quote_report",
    {
      title: "Quote report",
      description: "Quote an x402 price for a live AgentPay evidence report.",
      inputSchema: { reportApiUrl }
    },
    async (input) => textResult(await quoteReportTool(input))
  );

  server.registerTool(
    "payment_status",
    {
      title: "Payment status",
      description: "Check whether AgentPay's configured Casper x402 facilitator path is ready to accept payment.",
      inputSchema: { reportApiUrl }
    },
    async (input) => textResult(await paymentStatusTool(input))
  );

  server.registerTool(
    "registry_status",
    {
      title: "Registry status",
      description: "Check whether AgentPay's Casper registry recording path is configured and reachable.",
      inputSchema: {}
    },
    async () => textResult(await registryStatusTool())
  );

  server.registerTool(
    "buy_report",
    {
      title: "Buy report",
      description: "Buy the evidence report with an x402 payment payload.",
      inputSchema: {
        reportApiUrl,
        quoteId: z.string(),
        paymentPayload: z.unknown().optional()
      }
    },
    async (input) => textResult(await buyReportTool(input))
  );

  server.registerTool(
    "verify_report",
    {
      title: "Verify report",
      description: "Verify the report Merkle proof against the dataset root.",
      inputSchema: {
        reportApiUrl,
        record: z.object({
          id: z.string(),
          product: z.string(),
          network: z.string(),
          subject: z.string(),
          observedAt: z.string(),
          sourceUrl: z.string(),
          facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          rawHash: z.string()
        }),
        proof: z.array(
          z.object({
            position: z.enum(["left", "right"]),
            hash: hex64
          })
        ),
        datasetRoot: hex64
      }
    },
    async (input) => textResult(await verifyReportTool(input))
  );

  server.registerTool(
    "record_decision",
    {
      title: "Record decision",
      description: "Record an AgentPay trust decision through the Casper boundary.",
      inputSchema: {
        datasetId: z.string(),
        datasetRoot: hex64,
        reportHash: z.string(),
        paymentReceiptHash: z.string(),
        decision: z.enum(["approved", "rejected", "needs_review"])
      }
    },
    async (input) => textResult(await recordDecisionTool(input))
  );

  server.registerTool(
    "assess_subject",
    {
      title: "Assess subject",
      description:
        "Full Trust Signal rail: quotes evidence, pays x402, verifies Merkle proofs, scores deterministically, narrates, and stamps the verdict on Casper. Returns a Verdict.",
      inputSchema: {
        subject: z.string().describe("Casper package hash (64 hex chars or hash-<64 hex>)"),
        reportApiUrl: reportApiUrl
      }
    },
    async (input) => textResult(await assessSubjectTool(input))
  );

  return server;
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value)
      }
    ]
  };
}
