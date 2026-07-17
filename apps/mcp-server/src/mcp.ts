import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  assessAccountTool,
  assessSubjectTool,
  buyReportTool,
  checkX402PaymentTool,
  getPaymentReceiptTool,
  paymentStatusTool,
  quoteReportTool,
  recordDecisionTool,
  registryStatusTool,
  verifyX402SettlementTool,
  verifyReportTool
} from "./tools.js";
import { AGENT_PAY_SKILL_URI, agentPaySkillMarkdown } from "./agentSkill.js";

const reportApiUrl = z.string().url().optional();
const evidenceNetwork = z.enum(["casper-mainnet", "casper-testnet"]).optional();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/i);
const paymentRequest = z.object({
  method: z.string(),
  url: z.string().url(),
  bodyHash: hex64,
  bodyBytes: z.number().int().nonnegative(),
  capturedAt: z.string(),
  adapterVersion: z.string()
});
const authorizationIntent = z.object({
  payerPublicKey: z.string(),
  from: z.string(),
  to: z.string(),
  amount: z.string(),
  validAfter: z.string(),
  validBefore: z.string(),
  nonce: hex64,
  network: z.literal("casper:casper-test"),
  asset: hex64,
  tokenName: z.string(),
  tokenVersion: z.string(),
  digest: hex64
});

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
      description: "Machine-readable AgentPay payment and Casper-check integration contract.",
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
      description:
        "Get the price and payment terms for a live AgentPay check of a Casper token or account.",
      inputSchema: {
        subject: z.string().describe("CSPR.trade token symbol, token package hash, CSPR.name, Casper account hash, or Casper public key"),
        evidenceNetwork,
        reportApiUrl
      }
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
        "Read live Casper evidence, pay over x402, verify every proof, apply fixed rules, and record the verdict on Casper Testnet.",
      inputSchema: {
        subject: z.string().describe("CSPR.trade token symbol, token package hash, Casper account hash, or Casper public key"),
        evidenceNetwork,
        reportApiUrl: reportApiUrl
      }
    },
    async (input) => textResult(await assessSubjectTool(input))
  );

  server.registerTool(
    "assess_account",
    {
      title: "Assess account",
      description:
        "Check a Casper account's existence, CSPR balance, and multisig control; score it with the account policy and stamp the verdict on Casper.",
      inputSchema: {
        account: z.string().describe("CSPR.name, account-hash-<64 hex>, bare 64-hex account hash, or Casper public key"),
        evidenceNetwork,
        reportApiUrl
      }
    },
    async (input) => textResult(await assessAccountTool(input))
  );

  server.registerTool(
    "check_x402_payment",
    {
      title: "Check x402 payment",
      description: "Check x402 terms and an unsigned Casper authorization before payment.",
      inputSchema: {
        agentPayApiUrl: reportApiUrl,
        request: paymentRequest,
        paymentRequired: z.record(z.string(), z.unknown()),
        authorization: authorizationIntent,
        idempotencyKey: z.string().optional()
      }
    },
    async (input) => textResult(await checkX402PaymentTool(input))
  );

  server.registerTool(
    "verify_x402_settlement",
    {
      title: "Verify x402 settlement",
      description: "Verify that a Casper transaction settled the exact payment AgentPay approved.",
      inputSchema: {
        agentPayApiUrl: reportApiUrl,
        checkId: z.string().min(1),
        transactionHash: hex64
      }
    },
    async (input) => textResult(await verifyX402SettlementTool(input))
  );

  server.registerTool(
    "get_payment_receipt",
    {
      title: "Get payment receipt",
      description: "Get the independently verifiable receipt for a completed payment check.",
      inputSchema: {
        agentPayApiUrl: reportApiUrl,
        receiptId: z.string().min(1)
      }
    },
    async (input) => textResult(await getPaymentReceiptTool(input))
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
