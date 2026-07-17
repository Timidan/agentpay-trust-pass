#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  kill "${API_PID:-}" "${MCP_PID:-}" 2>/dev/null || true
}

trap cleanup EXIT

REPORT_API_PORT="${REPORT_API_PORT:-4021}"
REPORT_API_URL="${REPORT_API_URL:-http://127.0.0.1:${REPORT_API_PORT}}"
MCP_SERVER_PORT="${MCP_SERVER_PORT:-3001}"
MCP_SERVER_URL="${MCP_SERVER_URL:-http://127.0.0.1:${MCP_SERVER_PORT}}"
WEB_PORT="${WEB_PORT:-5173}"
WEB_PUBLIC_ORIGIN="${AGENTPAY_PUBLIC_ORIGIN:-http://127.0.0.1:${WEB_PORT}}"
WEB_ORIGINS="http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}"

REPORT_API_PORT="$REPORT_API_PORT" \
  AGENTPAY_PUBLIC_ORIGIN="$WEB_PUBLIC_ORIGIN" \
  AGENT_PAY_RESOURCE_BASE_URL="${AGENT_PAY_RESOURCE_BASE_URL:-$REPORT_API_URL}" \
  AGENTPAY_ALLOWED_ORIGINS="${AGENTPAY_ALLOWED_ORIGINS:-$WEB_ORIGINS}" \
  ./node_modules/.bin/tsx apps/report-api/src/server.ts &
API_PID=$!
# No MCP_ALLOW_UNAUTHENTICATED_PRIVILEGED_TOOLS here: the bridge auto-permits
# privileged tools for genuine loopback peers (the local web console), while
# proxied/non-loopback requests stay denied. Forcing the flag on would re-open
# that gate for any deployment that copies these dev settings behind a proxy.
REPORT_API_URL="$REPORT_API_URL" \
  MCP_SERVER_PORT="$MCP_SERVER_PORT" \
  MCP_ALLOWED_ORIGINS="${MCP_ALLOWED_ORIGINS:-$WEB_ORIGINS}" \
  ./node_modules/.bin/tsx apps/mcp-server/src/server.ts &
MCP_PID=$!
(
  cd apps/web
  WEB_PORT="$WEB_PORT" \
    VITE_REPORT_API_URL="${VITE_REPORT_API_URL:-$REPORT_API_URL}" \
    VITE_MCP_SERVER_URL="${VITE_MCP_SERVER_URL:-$MCP_SERVER_URL}" \
    VITE_AGENTPAY_SERVICE_URL="${VITE_AGENTPAY_SERVICE_URL:-$REPORT_API_URL}" \
    ../../node_modules/.bin/vite --host 127.0.0.1
)
