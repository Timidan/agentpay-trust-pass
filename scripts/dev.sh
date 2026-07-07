#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  kill "${API_PID:-}" "${MCP_PID:-}" 2>/dev/null || true
}

trap cleanup EXIT

REPORT_API_PORT="${REPORT_API_PORT:-4021}"
REPORT_API_URL="${REPORT_API_URL:-http://127.0.0.1:${REPORT_API_PORT}}"
MCP_SERVER_PORT="${MCP_SERVER_PORT:-3001}"

REPORT_API_PORT="$REPORT_API_PORT" ./node_modules/.bin/tsx apps/report-api/src/server.ts &
API_PID=$!
REPORT_API_URL="$REPORT_API_URL" MCP_SERVER_PORT="$MCP_SERVER_PORT" ./node_modules/.bin/tsx apps/mcp-server/src/server.ts &
MCP_PID=$!
(cd apps/web && ../../node_modules/.bin/vite --host 127.0.0.1)
