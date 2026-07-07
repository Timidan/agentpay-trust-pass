#!/usr/bin/env bash
set -euo pipefail

npm test
npm run build

REPORT_API_PORT="${REPORT_API_PORT:-4021}"
MCP_SERVER_PORT="${MCP_SERVER_PORT:-3001}"
REPORT_API_URL="http://127.0.0.1:${REPORT_API_PORT}"
MCP_SERVER_URL="http://127.0.0.1:${MCP_SERVER_PORT}"

cleanup() {
  kill "${REPORT_PID:-}" "${MCP_PID:-}" 2>/dev/null || true
}

trap cleanup EXIT

REPORT_API_PORT="$REPORT_API_PORT" ./node_modules/.bin/tsx apps/report-api/src/server.ts >/tmp/agent-pay-report-api.log 2>&1 &
REPORT_PID=$!

REPORT_API_URL="$REPORT_API_URL" MCP_SERVER_PORT="$MCP_SERVER_PORT" ./node_modules/.bin/tsx apps/mcp-server/src/server.ts >/tmp/agent-pay-mcp-server.log 2>&1 &
MCP_PID=$!

wait_for_url() {
  local url="$1"
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

wait_for_url "$REPORT_API_URL/health"
wait_for_url "$MCP_SERVER_URL/health"

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
  if (registryStatus.reason !== "agent_pay_registry_package_hash_required") {
    throw new Error(`Expected missing local AgentPay registry config, got ${JSON.stringify(registryStatus)}`);
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
