import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createReportApp } from "@agent-pay/report-api/src/app";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentPayMcpServer } from "../src/mcp";

const envSnapshot = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
});

async function withReportApi<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const app = createReportApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer, reject) => {
    const pending = app.listen(0, "127.0.0.1");
    pending.once("listening", () => resolveServer(pending));
    pending.once("error", reject);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Report API did not bind to a TCP port");
    }
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("MCP stdio server", () => {
  it("lists and reads the AgentPay skill resource", async () => {
    process.env.AGENT_PAY_PUBLIC_ORIGIN = "https://agentpay.example";
    const client = new Client({ name: "agent-pay-skill-test-client", version: "0.1.0" });
    const server = createAgentPayMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const resources = await client.listResources();
      expect(resources.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "agentpay-skill",
            uri: "skill://agentpay"
          })
        ])
      );

      const skill = await client.readResource({ uri: "skill://agentpay" });
      expect(skill.contents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            uri: "skill://agentpay",
            mimeType: "text/markdown",
            text: expect.stringContaining("https://agentpay.example")
          })
        ])
      );
      expect(JSON.stringify(skill.contents)).not.toContain("$AGENT_PAY_BASE_URL");
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);

  it("lists tools and calls quote_report through the MCP SDK", async () => {
    clearPaymentEnv();
    await withReportApi(async (reportApiUrl) => {
      const client = new Client({ name: "agent-pay-test-client", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: resolve(process.cwd().replace(/\/apps\/mcp-server$/, ""), "node_modules/.bin/tsx"),
        args: ["apps/mcp-server/src/stdio.ts"],
        cwd: process.cwd().replace(/\/apps\/mcp-server$/, ""),
        env: {
          REPORT_API_URL: reportApiUrl
        },
        stderr: "pipe"
      });

      await client.connect(transport);
      try {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining([
            "quote_report",
            "payment_status",
            "registry_status",
            "buy_report",
            "verify_report",
            "record_decision"
          ])
        );

        const quote = await client.callTool({
          name: "quote_report",
          arguments: { reportApiUrl, subject: "a".repeat(64) }
        });

        expect(JSON.parse(quote.content[0].type === "text" ? quote.content[0].text : "{}")).toMatchObject({
          asset: "CSPR"
        });
        expect(JSON.parse(quote.content[0].type === "text" ? quote.content[0].text : "{}").quoteId).toMatch(
          /^trust-/
        );
      } finally {
        await client.close();
      }
    });
  }, 20_000);
});

function clearPaymentEnv() {
  delete process.env.X402_ASSET_PACKAGE_HASH;
  delete process.env.PAYEE_ADDRESS;
  delete process.env.X402_FACILITATOR_URL;
  delete process.env.X402_FACILITATOR_AUTH_TOKEN;
  delete process.env.CSPR_CLOUD_ACCESS_TOKEN;
}
