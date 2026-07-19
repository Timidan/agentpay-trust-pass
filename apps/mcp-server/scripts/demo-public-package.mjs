import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageName = "@timidan/agentpay-mcp";
const officialTestnetWcspr =
  "hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e";

const client = new Client({ name: "agentpay-final-demo", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "npx",
  args: ["--yes", packageName],
  stderr: "pipe"
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const result = await client.callTool({
    name: "quote_report",
    arguments: {
      subject: officialTestnetWcspr,
      evidenceNetwork: "casper-testnet"
    }
  });

  if (result.isError) {
    throw new Error(textContent(result.content) || "quote_report failed");
  }

  const quote = JSON.parse(textContent(result.content));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    package: packageName,
    tools: tools.tools.length,
    call: "quote_report",
    subject: "official Testnet WCSPR",
    evidenceNetwork: quote.evidenceNetwork,
    payment: `${quote.amountDisplay ?? "unknown"} ${quote.asset ?? ""}`.trim(),
    paymentNetwork: quote.network,
    paymentReadiness: quote.paymentReadiness?.status,
    evidenceSources: quote.sourceSummary?.length ?? 0,
    datasetRoot: quote.datasetRoot
  }, null, 2)}\n`);
} finally {
  await client.close();
}

function textContent(content) {
  if (!Array.isArray(content)) return "";
  const block = content.find(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      value.type === "text" &&
      typeof value.text === "string"
  );
  return block?.text ?? "";
}
