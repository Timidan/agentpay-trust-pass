#!/usr/bin/env bash
set -euo pipefail

npm test
npm run build

REPORT_API_PORT="${AGENT_PAY_SMOKE_REPORT_API_PORT:-4121}"
MCP_SERVER_PORT="${AGENT_PAY_SMOKE_MCP_SERVER_PORT:-3101}"
REPORT_API_URL="http://127.0.0.1:${REPORT_API_PORT}"
MCP_SERVER_URL="http://127.0.0.1:${MCP_SERVER_PORT}"
SMOKE_DIRECTORY="$(mktemp -d -t agentpay-smoke-XXXXXX)"

cleanup() {
  if [ -n "${REPORT_PID:-}" ]; then kill "$REPORT_PID" 2>/dev/null || true; fi
  if [ -n "${MCP_PID:-}" ]; then kill "$MCP_PID" 2>/dev/null || true; fi
  wait "${REPORT_PID:-}" "${MCP_PID:-}" 2>/dev/null || true
  rm -rf "$SMOKE_DIRECTORY"
}

trap cleanup EXIT

NODE_ENV=production \
  REPORT_API_HOST=127.0.0.1 \
  REPORT_API_PORT="$REPORT_API_PORT" \
  AGENTPAY_DATABASE_PATH="$SMOKE_DIRECTORY/agentpay.sqlite" \
  AGENTPAY_PUBLIC_ORIGIN=https://agentpay.smoke.invalid \
  AGENT_PAY_RESOURCE_BASE_URL=https://agentpay.smoke.invalid/api \
  node --conditions=production apps/report-api/dist/server.js >"$SMOKE_DIRECTORY/report-api.log" 2>&1 &
REPORT_PID=$!

NODE_ENV=production \
  REPORT_API_URL="$REPORT_API_URL" \
  AGENT_PAY_RESOURCE_BASE_URL=https://agentpay.smoke.invalid/api \
  MCP_SERVER_HOST=127.0.0.1 \
  MCP_SERVER_PORT="$MCP_SERVER_PORT" \
  MCP_ALLOW_UNAUTHENTICATED_PRIVILEGED_TOOLS=1 \
  node --conditions=production apps/mcp-server/dist/server.js >"$SMOKE_DIRECTORY/mcp-server.log" 2>&1 &
MCP_PID=$!

wait_for_service() {
  local url="$1"
  local pid="$2"
  local log="$3"
  for _ in $(seq 1 40); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Service process exited before $url became ready" >&2
      sed -n '1,120p' "$log" >&2
      return 1
    fi
    if curl -fsS "$url" >/dev/null 2>&1; then
      kill -0 "$pid" 2>/dev/null
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

wait_for_service "$REPORT_API_URL/health" "$REPORT_PID" "$SMOKE_DIRECTORY/report-api.log"
wait_for_service "$MCP_SERVER_URL/health" "$MCP_PID" "$SMOKE_DIRECTORY/mcp-server.log"

MCP_SERVER_URL="$MCP_SERVER_URL" node --input-type=module <<'NODE'
const mcpUrl = process.env.MCP_SERVER_URL;

async function callTool(tool, payload) {
  const response = await fetch(`${mcpUrl}/tools/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${tool} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// Smoke fixture: a well-formed but nonexistent package hash. Every quote is
// subject-scoped now; token-state degrades to "not checked" with no network
// dependency, so this only exercises the quote/x402-gate shape.
const SMOKE_SUBJECT = "a".repeat(64);
const quote = await callTool("quote_report", { subject: SMOKE_SUBJECT });
if (!quote.quoteId.startsWith("trust-")) {
  throw new Error(`Unexpected quote id: ${quote.quoteId}`);
}
if (!Array.isArray(quote.sourceSummary) || quote.sourceSummary.length < 2) {
  throw new Error("Expected subject-scoped Casper source summaries");
}
if (quote.paymentReadiness?.status === "ready") {
  if (!Array.isArray(quote.paymentRequirements) || quote.paymentRequirements.length === 0) {
    throw new Error(`Expected ready payment quote to advertise payment requirements, got ${JSON.stringify(quote)}`);
  }
} else if (quote.paymentReadiness?.status === "configuration_required") {
  if (quote.paymentReadiness.reason !== "x402_asset_package_hash_required") {
    throw new Error(`Expected explicit local payment readiness, got ${JSON.stringify(quote.paymentReadiness)}`);
  }
} else {
  throw new Error(`Expected ready or configuration_required payment readiness, got ${JSON.stringify(quote.paymentReadiness)}`);
}

const paymentStatus = await callTool("payment_status", {});
if (paymentStatus.status === "ready") {
  if (!paymentStatus.supportedKind) {
    throw new Error(`Expected ready payment status to include supportedKind, got ${JSON.stringify(paymentStatus)}`);
  }
} else if (paymentStatus.status === "configuration_required") {
  if (paymentStatus.reason !== "x402_asset_package_hash_required") {
    throw new Error(`Expected missing local x402 asset config, got ${JSON.stringify(paymentStatus)}`);
  }
} else {
  throw new Error(`Expected ready or explicit missing x402 config, got ${JSON.stringify(paymentStatus)}`);
}

const registryStatus = await callTool("registry_status", {});
if (registryStatus.status === "ready") {
  if (!registryStatus.registryPackageHash || !registryStatus.rpc) {
    throw new Error(`Expected ready registry status to include package hash and rpc, got ${JSON.stringify(registryStatus)}`);
  }
} else if (registryStatus.status === "configuration_required") {
  if (registryStatus.reason !== "agent_pay_registry_configuration_required") {
    throw new Error(`Expected missing local AgentPay registry config, got ${JSON.stringify(registryStatus)}`);
  }
  const missingChecks = new Set(
    registryStatus.checks
      ?.filter((check) => check.status === "missing")
      .map((check) => check.name)
  );
  if (!missingChecks.has("decision_registry") || !missingChecks.has("receipt_recording")) {
    throw new Error(`Expected both local registry capabilities to need setup, got ${JSON.stringify(registryStatus)}`);
  }
  if (registryStatus.receiptAnchors?.reason !== "receipt_recording_configuration_required") {
    throw new Error(`Expected explicit receipt recording readiness, got ${JSON.stringify(registryStatus)}`);
  }
} else {
  throw new Error(`Expected ready or explicit missing registry config, got ${JSON.stringify(registryStatus)}`);
}

const response = await fetch(`${mcpUrl}/tools/buy_report`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ quoteId: quote.quoteId })
});
const buyBody = await response.json();
if (response.status !== 402 || buyBody.error !== "payment_required") {
  throw new Error(`Expected x402 payment gate, got ${response.status} ${JSON.stringify(buyBody)}`);
}

console.log(JSON.stringify({
  quoteId: quote.quoteId,
  reportId: quote.reportId,
  sources: quote.sourceSummary.map((source) => source.product),
  readiness: paymentStatus.status === "ready" ? "ready" : paymentStatus.reason,
  registry: registryStatus.status === "ready" ? "ready" : registryStatus.reason,
  payment: buyBody.reason
}, null, 2));
NODE

pnpm --filter @agent-pay/mcp-server exec node --input-type=module <<'NODE'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "agentpay-compiled-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--conditions=production", "dist/stdio.js"],
  cwd: process.cwd(),
  stderr: "pipe"
});

await client.connect(transport);
try {
  const response = await client.listTools();
  const names = new Set(response.tools.map((tool) => tool.name));
  for (const required of ["assess_subject", "assess_account", "check_x402_payment"]) {
    if (!names.has(required)) throw new Error(`Compiled MCP stdio server omitted ${required}`);
  }
  console.log(JSON.stringify({ compiledMcpTools: response.tools.length }));
} finally {
  await client.close();
}
NODE
