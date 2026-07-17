#!/usr/bin/env node

const HOSTED_AGENTPAY_API = "https://agentpay.timidan.xyz/api";

process.env.NODE_ENV ??= "production";
process.env.REPORT_API_URL ??= HOSTED_AGENTPAY_API;
process.env.AGENT_PAY_API_URL ??= HOSTED_AGENTPAY_API;
process.env.AGENT_PAY_RESOURCE_BASE_URL ??= HOSTED_AGENTPAY_API;

const [{ StdioServerTransport }, { createAgentPayMcpServer }] = await Promise.all([
  import("@modelcontextprotocol/sdk/server/stdio.js"),
  import("./mcp.js")
]);

const server = createAgentPayMcpServer();
await server.connect(new StdioServerTransport());
