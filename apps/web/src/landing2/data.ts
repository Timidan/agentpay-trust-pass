export const EXPLORER = "https://testnet.cspr.live";

/** Middle-truncate a long hash so it fits 320px without overlap. */
export function shortHash(value: string, head = 8, tail = 6): string {
  const bare = value.startsWith("hash-") ? value.slice(5) : value;
  if (bare.length <= head + tail + 1) return value;
  const prefix = value.startsWith("hash-") ? "hash-" : "";
  return `${prefix}${bare.slice(0, head)}…${bare.slice(-tail)}`;
}

// The three real MCP tool names (apps/mcp-server/src/tools.ts) with the honest
// backend-owned answers each one returns.
// One entry per integration surface. Every tool, route, subcommand, and type
// below exists in this repo (apps/mcp-server, apps/cli, packages/agent-pay-client).
export const AGENT_SURFACES: ReadonlyArray<{ id: string; name: string; title: string; code: string }> = [
  {
    id: "mcp",
    name: "MCP",
    title: "agentpay · MCP",
    code: `# MCP tools an agent calls before it signs
check_x402_payment      -> PAY | REVIEW | BLOCK
verify_x402_settlement  -> match | pending | mismatch | unverifiable
get_payment_receipt     -> receipt body + anchor state`
  },
  {
    id: "http",
    name: "HTTP",
    title: "agentpay · HTTP bridge",
    code: `# the same three tools over the HTTP bridge
POST /tools/check_x402_payment
POST /tools/verify_x402_settlement
POST /tools/get_payment_receipt

# the hosted bridge uses its own bearer token
Authorization: Bearer <bridge token>`
  },
  {
    id: "cli",
    name: "CLI",
    title: "agentpay · CLI",
    code: `# check a charge, then prove the settlement
agentpay check              -> PAY | REVIEW | BLOCK
agentpay verify-settlement  -> match | pending | mismatch | unverifiable
agentpay receipt show|verify
agentpay provider pin|deny
agentpay policy show|set`
  },
  {
    id: "ts",
    name: "TypeScript",
    title: "@agent-pay/client",
    code: `import { AgentPayHttpClient, checkX402Payment } from "@agent-pay/client";

const api = new AgentPayHttpClient({ baseUrl, token });

const { check } = await checkX402Payment(api, {
  request,
  paymentRequired,     // the service's real 402 body
  authorization: null, // returns REVIEW until payer details are prepared
  idempotencyKey
});
check.decision; // "pay" | "review" | "block"`
  }
];

// The eight-step workflow. Order is load-bearing: approval is never payment,
// and signing stays in the wallet.
export const WORKFLOW: ReadonlyArray<{ name: string; body: string }> = [
  { name: "Read charge", body: "Capture the service's real payment request." },
  { name: "Check", body: "Score the charge against your policy." },
  { name: "Decision", body: "PAY, REVIEW, or BLOCK, always with concrete reasons." },
  { name: "Sign locally", body: "Your wallet signs. The backend never sees the key." },
  { name: "Settle", body: "The signed payment settles on Casper." },
  { name: "Verify", body: "Confirm the transfer matched the approved terms." },
  { name: "Observe", body: "Record the bounded service response." },
  { name: "Receipt saved", body: "Write the receipt hash to Casper and read it back." },
];

// The same eight steps grouped into four narrative phases for the landing
// timeline. Nothing is dropped: each phase lists its real sub-steps.
export const PHASES: ReadonlyArray<{
  name: string;
  body: string;
  steps: ReadonlyArray<string>;
}> = [
  {
    name: "Check",
    body: "AgentPay captures the service's real charge and decides: PAY, REVIEW, or BLOCK, with concrete reasons.",
    steps: ["Read charge", "Check", "Decision"]
  },
  {
    name: "Sign & settle",
    body: "Your wallet signs and the payment settles on Casper. The backend never sees the key.",
    steps: ["Sign locally", "Settle"]
  },
  {
    name: "Verify",
    body: "The settled transfer is matched against the approved terms, and the service response is recorded.",
    steps: ["Verify", "Observe"]
  },
  {
    name: "Receipt",
    body: "The receipt hash is written to the AgentPay registry on Casper and read back for confirmation.",
    steps: ["Receipt saved"]
  }
];
