<div align="center">

<img src="docs/assets/logo.png" alt="AgentPay" width="104" height="104" />

<h1>AgentPay</h1>

**Check a Casper x402 charge before an agent signs it, then prove what settled.**

[![Live demo](https://img.shields.io/badge/demo-agentpay.timidan.xyz-6C5CE7?style=flat-square)](https://agentpay.timidan.xyz)
[![Casper](https://img.shields.io/badge/Casper-Testnet-FF0012?style=flat-square)](https://cspr.live)
[![x402](https://img.shields.io/badge/x402-payments-1E1E28?style=flat-square)](https://agentpay.timidan.xyz)
[![MCP](https://img.shields.io/badge/MCP-server%20%2B%20bridge-1E1E28?style=flat-square)](#agent-integration)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Node >= 22.13](https://img.shields.io/badge/Node-%E2%89%A522.13-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

[Live demo](https://agentpay.timidan.xyz) · [How it works](#what-it-does) · [Agent integration](#agent-integration) · [Local development](#local-development) · [Casper Testnet evidence](#verified-casper-testnet-evidence)

    <img src="docs/assets/hero.png" alt="AgentPay reads a payment request before your agent signs it and answers PAY, REVIEW, or BLOCK." width="860" />

</div>

---

AgentPay intercepts an HTTP 402 payment request, checks the service, payee, token, amount, authorization, and operator policy, and returns **PAY**, **REVIEW**, or **BLOCK**. A PAY decision never sends money: the buyer signs locally, submits the payment itself, and gives AgentPay only the resulting transaction hash to verify.

After payment, AgentPay compares the executed Casper transfer with the exact approved terms, records the service response, and issues a tamper-evident receipt. An optional Casper registry anchor commits that receipt hash using a dedicated recorder account. The payment-audit API never reads a buyer private key.

The qualified paid-evidence product remains a built-in AgentPay service: it buys live Casper evidence over x402, verifies its Merkle proof, scores it deterministically, and records the result. It now runs through the same pre-payment and settlement checks available to any x402 service.

---

## What it does

Every x402 purchase runs the same four steps. AgentPay approves terms; the buyer remains in control of signing and submission.

```
  1. Capture 402       2. Check terms         3. Sign and pay        4. Verify + receipt
  -------------       --------------         ---------------        ------------------
  Normalize the       Apply provider,        The buyer signs        Match the executed
  service request     payee, asset, amount,  locally only after     Casper transfer and
  and x402 charge.    spend, and token rules. AgentPay says PAY.    record the response.
```

Receipts bind the original request, normalized payment terms, policy revision, provider decision, authorization, settlement proof, and observed response. `agentpay receipt verify` checks a receipt offline.

<div align="center">
<img src="docs/assets/audit-desk.png" alt="The AgentPay payment checker, from captured charge to an anchored receipt." width="820" />
<br />
<sub>The payment checker follows a charge from capture to an anchored receipt and shows the result of every step.</sub>
</div>

### Three ways to use it

| Surface | Route / entry | What it does |
|---|---|---|
| **Agents** | `@agent-pay/client`, MCP, or HTTP | Capture a 402, request a decision, sign locally after PAY, then verify settlement and response. |
| **People** | web app | Inspect a payment request, understand the decision, manage policy and providers, and verify receipts. |
| **Developers** | `agentpay` CLI | Check payment JSON, run a complete checked call, manage policy/provider records, and verify receipts. |
| **Evidence users** | token, account, and report routes | Run a paid Casper check through the same payment controls. |

Every page, command, endpoint, and the credential each one needs is mapped in
[docs/user-surfaces.md](docs/user-surfaces.md).

---

## Payment decisions

| Decision | Meaning |
|---|---|
| **PAY** | The normalized charge, authorization, provider record, and spend policy all match. The buyer may sign locally. |
| **REVIEW** | AgentPay cannot safely decide without an operator, commonly because the provider is unknown or required evidence is unavailable. |
| **BLOCK** | A hard rule failed, such as a denied provider, changed payee, wrong token, amount above policy, replayed authorization, or unsafe token evidence. |

## Evidence verdicts

Scoring is deterministic and lives in one pure package (`packages/agent-pay-core`). The same rule engine powers the web UI, the console, and the agent tools, so a verdict never depends on who asked.

| Verdict | Meaning |
|---|---|
| **CLEAR** | Every mandatory fact was read and every required check passed. |
| **CAUTION** | A soft flag fired, or a mandatory check could not run this time. |
| **DANGER** | A required check found a concrete risk, such as enabled CEP-18 mint/burn functions or a missing account. |

Each result carries three signal-backed lists: **flags** (what fired, with severity), **passed** (mandatory checks that ran clean), and **not checked** (mandatory signals that could not be read this run). The desk does not fabricate a clean check it did not perform.

---

## Architecture

An npm-workspaces monorepo. Each layer is independently testable.

```
apps/web                       React 19 + Vite front end (landing, token check, account check, feed, agent docs, console)
apps/report-api                Express payment-audit and paid-evidence API with durable SQLite state
apps/cli                       Installable command line client for checks, calls, policy, providers, and receipts
apps/mcp-server                MCP server over stdio + HTTP bridge for payment and evidence tools
packages/agent-pay-client      Non-custodial HTTP client, local Casper signer, and checked-call workflow
packages/agent-pay-core        Canonical schemas, deterministic policy, settlement checks, and receipt verification
contracts/agent-pay-registry   Rust/Wasm append-only receipt anchors plus the qualified decision entrypoint
```

The core is dependency-injected and has no network or key access, which is why the policy is unit-testable without a chain. The layers above wire in the real Casper RPC, the x402 facilitator, and the registry submitter.

**Live integrations:** CSPR.trade resolves listed Mainnet symbols and supplies exact pool observations; CSPR.name resolves human-readable Mainnet accounts; CSPR.live supplies public holder and contract-history evidence; Casper JSON-RPC independently reads contract state, total supply, and transaction execution. CSPR.cloud remains an optional discovery and hosted-facilitator integration.

---

## Local development

Requires **Node.js >= 22.13**. Building the contract additionally needs a Rust toolchain and `binaryen` (see [Deploying to Casper Testnet](#deploying-to-casper-testnet)).

```bash
npm install
npm run dev      # report-api on :4021, mcp bridge on :3001, web on :5173
```

Open `http://localhost:5173` and try a token check. This address is only for
local development; the hosted product is
[`https://agentpay.timidan.xyz`](https://agentpay.timidan.xyz). Without payment
credentials configured, the local stack runs up to the x402 payment request
and stops with an honest "signing key not configured" message. Reading evidence
and quoting is free, but buying evidence and recording a verdict needs a funded
Casper key.

```bash
npm test         # workspace unit tests + script tests + the Rust contract tests
npm run build    # build every workspace + the registry Wasm
npm run smoke    # boot the report API and probe the live capability surface
```

---

## Agent integration

Agents talk to AgentPay over MCP (stdio) or the hosted HTTP bridge. Install is not required: any MCP client that can run `npx` can start the published adapter. Give it a scoped AgentPay token for payment checks and receipts:

```json
{
  "mcpServers": {
    "agent-pay": {
      "command": "npx",
      "args": ["--yes", "@timidan/agentpay-mcp"],
      "env": {
        "AGENT_PAY_API_TOKEN": "<scoped-agent-token>"
      }
    }
  }
}
```

The package defaults to `https://agentpay.timidan.xyz/api`. Public quotes,
payment status, and proof verification work without a token. A one-call paid
token or account assessment additionally needs a local Testnet buyer key and
registry configuration; the key stays in the MCP process.

Or call the hosted bridge directly at
`POST https://agentpay.timidan.xyz/bridge/tools/<name>` with
`Authorization: Bearer <bridge-token>`. The browser app uses same-origin
`/api` and `/bridge` routes, so the deployed UI never points a user back to
their own machine.

For a public deployment, configure a 32-character-or-longer
`MCP_SERVER_AUTH_TOKEN`. Readiness status remains public. The web UI can use only `assess_subject` and
`assess_account` without that token when `MCP_PUBLIC_TESTNET_ASSESSMENTS=1`;
that mode keeps the check fee and registry write on Testnet, requires an exact
browser-origin allowlist, and enforces per-client and daily budgets. Evidence
may still be read from Casper Mainnet or Testnet. Every other privileged
HTTP tool remains bearer protected. Stdio MCP is unaffected by the HTTP bridge
policy.

### Tools

| Tool | Purpose |
|---|---|
| `quote_report` | Returns price, evidence network, dataset root, and x402 terms for a CSPR.trade symbol, token package, CSPR.name, or Casper account. |
| `payment_status` | Reports x402 readiness (asset, payee, facilitator, network). |
| `registry_status` | Reports registry readiness (package hash, submitter, RPC). |
| `buy_report` | Replays the quote with a signed x402 `PAYMENT-SIGNATURE` payload and unlocks the report. |
| `verify_report` | Checks the released report and Merkle proof against the quoted dataset root. |
| `record_decision` | Writes `approved` / `needs_review` / `rejected` to the Casper registry. |
| `assess_subject` | Resolves an optional CSPR.trade symbol or CSPR.name, then quotes, pays, verifies, scores, and records the check. |
| `assess_account` | Runs the same paid check for a CSPR.name, account hash, or public key. |
| `check_x402_payment` | Normalize an x402 request and return PAY, REVIEW, or BLOCK before signing. |
| `verify_x402_settlement` | Verify that an executed Casper transaction matches the exact approved terms. |
| `get_payment_receipt` | Return the verifiable purchase receipt and its current Casper anchor state. |

`payment_status` and `registry_status` are deliberately separate from mutation tools, so an agent can detect missing configuration first. For manual report purchase, generate a buyer payload locally with `npm run x402:buy` and pass only the signed payload to `buy_report`.

---

## Configuration

Reading evidence and checking a captured 402 need no server-side buyer key. Buyer signing happens in the client or CLI. Registry anchoring uses a separate recorder key (set via process env or a local `.env`; nothing secret is committed):

| Variable | Used for |
|---|---|
| `CASPER_RPC_URL` | Reading chain state and confirming transactions. |
| `AGENTPAY_DEFAULT_EVIDENCE_NETWORK` | Default read network for exact token/account identifiers: `casper-mainnet` or `casper-testnet`. |
| `AGENTPAY_MAINNET_RPC_URL` / `AGENTPAY_TESTNET_RPC_URL` | Read-only RPC endpoints selected by the evidence network. |
| `CASPER_SECRET_KEY_PATH` | Buyer-side only: signs x402 payments and may submit the qualified legacy decision record. Never read by the payment-audit API. |
| `X402_ASSET_PACKAGE_HASH` | The CEP-18 fee asset, as raw 64 hex chars. |
| `PAYEE_ADDRESS` | The account that receives payment, in `00<64 hex>` form. |
| `X402_FACILITATOR_URL` | The x402 facilitator. The proven path is the self-hosted open-source `casper-x402`; hosted CSPR.cloud is a drop-in option (add `CSPR_CLOUD_ACCESS_TOKEN` or `X402_FACILITATOR_AUTH_TOKEN`). |
| `AGENT_PAY_REGISTRY_PACKAGE_HASH` | The deployed AgentPayRegistry, as `hash-<64 hex>` or raw 64 hex chars. |
| `AGENT_PAY_REGISTRY_CONTRACT_HASH` | The active registry contract hash used for receipt dictionary readback. |
| `AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH` | Dedicated recorder account installed in the registry contract. Must differ from the owner/buyer account. |
| `AGENT_PAY_REGISTRY_RECORDER_KEY_PATH` | Dedicated recorder key used only by the durable receipt-anchor worker. |
| `AGENT_PAY_API_TOKEN` | Scoped token used by agent, CLI, or MCP clients to create checks and read their receipts. |
| `AGENTPAY_DATABASE_PATH` | SQLite file for policies, checks, receipts, anchor jobs, verdict cards, and the opt-in public feed. Use a persistent volume in production. |
| `AGENTPAY_PUBLIC_ORIGIN` | Canonical HTTPS origin bound into operator authentication challenges and generated integration examples. |
| `AGENTPAY_ALLOWED_ORIGINS` | Exact comma-separated browser origins allowed to call the report API. No-`Origin` CLI and server clients remain supported. |
| `MCP_SERVER_AUTH_TOKEN` | Bearer token protecting the public HTTP bridge. Use at least 32 random characters. |
| `MCP_ALLOWED_ORIGINS` | Exact browser origins allowed to call the MCP HTTP bridge. |
| `MCP_PUBLIC_TESTNET_ASSESSMENTS` | Set to `1` only to let the public UI run the two funded assessment tools under Testnet-only rate and daily limits. |
| `VITE_AGENTPAY_SERVICE_URL` | Optional public HTTPS AgentPay service used by the payment checker's one-click WCSPR flow. Production uses `https://agentpay.timidan.xyz/api`. |
| `CSPR_NAME_API_BASE_URL` | Public CSPR.name resolution API. Defaults to `https://api.cspr.name`; HTTPS is required outside localhost. |
| `CSPR_LIVE_MAINNET_API_URL` / `CSPR_LIVE_TESTNET_API_URL` | Optional overrides for the public CSPR.live APIs used for holder, concentration, package-version, and install-height evidence. |
| `CSPR_CLOUD_ACCESS_TOKEN` | Optional token for CSPR.cloud discovery and, when selected, hosted facilitator authorization. Subject checks do not require it. |

The CLI exposes the same non-custodial flow. It is published as
[`@timidan/agentpay-cli`](https://www.npmjs.com/package/@timidan/agentpay-cli):

```bash
npm install -g @timidan/agentpay-cli

agentpay check --file payment-request.json --json
agentpay call --url https://service.example/resource --key ./buyer_secret_key.pem --json
agentpay verify-settlement --check <check-id> --tx <transaction-hash> --json
agentpay receipt show --id <receipt-id> --json
agentpay receipt verify --file receipt.json --json
```

First-time operator setup uses a Casper-signed challenge. The secret key is
read locally and is never sent to AgentPay:

```bash
agentpay session create --key ./testnet_secret_key.pem --json
agentpay agent-token issue --name my-agent --key ./testnet_secret_key.pem --json
agentpay agent-token list --session-token <operator-session-token> --json
```

The CLI defaults to `https://agentpay.timidan.xyz/api`. Use `--api-url` only
for a different deployment. Keep the returned operator session and agent token
out of shell history, logs, and source control.

AgentPay uses x402 V2 headers: the report API returns `PAYMENT-REQUIRED`, the buyer agent retries with `PAYMENT-SIGNATURE`, and a settled response includes `PAYMENT-RESPONSE`. A paid report is only released after facilitator verification, a raw 64-hex settlement hash, and an `info_get_transaction` confirmation that the hash executed.

---

## x402 buyer

The buyer agent that produces the `PAYMENT-SIGNATURE` lives in [scripts/x402-buyer.ts](scripts/x402-buyer.ts) (signing) and [scripts/x402-buy.ts](scripts/x402-buy.ts) (CLI). It builds the EIP-712 `TransferWithAuthorization` digest with the official `@casper-ecosystem/casper-eip-712` package and signs it with the exact Casper x402 scheme the facilitator verifies (secp256k1: `0x02 || ECDSA(sha256(digest))`; ed25519: `0x01 || ed25519(digest)`).

```bash
REPORT_API_URL=https://agentpay.timidan.xyz/api \
AGENT_PAY_SUBJECT=hash-<64-hex-package-hash> \
CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem \
npm run x402:buy
```

It quotes live evidence, signs the payment authorization, retries `buy_report` with `PAYMENT-SIGNATURE`, and prints the released report plus the confirmed settlement transaction, or the exact missing x402 configuration if the report API is not fully configured.

---

## Deploying the services

Production templates live in [deploy/agentpay](deploy/agentpay/README.md). They
run the report API and MCP bridge as separate loopback-only systemd services,
serve the built web app through nginx, expose the report API under `/api/` and
the MCP bridge under `/bridge/`, and keep
SQLite state in `/var/lib/agentpay`. This layout can share the existing droplet
with Findling without sharing a process, service account, environment file, or
database.

The production web build uses same-origin `/api` and `/bridge` routes. Do not
set `VITE_REPORT_API_URL`, `VITE_MCP_SERVER_URL`, or
`VITE_AGENTPAY_SERVICE_URL` for the standard nginx deployment; those variables
are only for intentional split-origin HTTPS deployments, and production builds
reject loopback overrides. Source `/etc/agentpay.env` for the server builds and
runtime services. TLS terminates at nginx; neither Node service should bind a
public interface.

---

## Deploying to Casper Testnet

Build the AgentPayRegistry Wasm:

```bash
npm run build:contract
```

This is not a plain `cargo build`. Casper's Wasm engine rejects the `bulk-memory` operations recent Rust toolchains emit by default, so [`build-contract.sh`](contracts/agent-pay-registry/scripts/build-contract.sh) recompiles `core`/`alloc` with those features disabled (`-Z build-std`), then lowers the residual `sign-ext`/nontrapping-fptoint operators back to MVP with `wasm-opt`. It requires **binaryen** (`wasm-opt`) on `PATH` (`npm i -g binaryen`) and fails loudly if any non-MVP opcode survives.

Create separate Testnet owner/buyer and registry-recorder keys (the generated directories are git-ignored):

```bash
cargo install casper-client
casper-client keygen .agentpay-testnet-key
casper-client keygen .agentpay-registry-recorder-key
npm run submission:funding
casper-client account-address --public-key .agentpay-registry-recorder-key/public_key_hex
```

Fund both printed accounts (faucet: https://testnet.cspr.live/tools/faucet). Set `CASPER_SECRET_KEY_PATH` to the owner key, `AGENT_PAY_REGISTRY_RECORDER_KEY_PATH` to the recorder key, and `AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH` to the recorder account printed above. Deploy and capture the install, package, and active contract hashes:

```bash
npm run submission:deploy-registry
```

The registry contract exposes append-only `record_purchase_receipt`, owner-only `set_recorder`, receipt readback, and the access-controlled qualified `record_decision_with_root` entrypoint. Readiness tooling requires the dedicated recorder values before reporting v2 ready. Never paste private key material into env files, chat, docs, or source.

---

## Verified Casper Testnet evidence

The original paid-evidence flow and the hardened payment-auditor flow were both captured with the self-hosted open-source `casper-x402` facilitator. The latest complete checked purchase binds one pre-payment decision, exact settlement, service response, immutable receipt, and receipt anchor:

- Registry v2 install: `2c53ec7d38757c7c252fa16acc4c099d1c53136c852f908821989ac42f0fa4e6`
- Registry v2 package: `hash-050b717617b9c79535983d9e0cc2ba21dd379ce3450498601dba64324a2dcd1a`
- Registry v2 contract: `hash-b5e129dca5548f1bbe225db73042d08ab5b35cc976c3ac955bf2fe2a8cd92ee3`
- Checked x402 settlement: `2491e2cfc3fc2c299ebdfb25725a8c8a194918b813f8c7596eec13bce3cd7911`
- Purchase receipt hash: `0f253ef7ce564e046d23abf42c8cabdad7b1deeab2fa4fafd2e3619f93cdf231`
- Receipt anchor transaction: `eb30265877e0bbb549efa6f09dbd8beb29efc31191724ce082fca45b6dddddfc`
- Qualification decision record: `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`

---

## Honesty and boundaries

The maintained, authoritative list of what runs live today is [docs/live-capabilities.md](docs/live-capabilities.md). Treat it as the product boundary before adding a claim anywhere. In short:

- **Live without payment credentials:** health, evidence quoting, x402 readiness, the 402 gate, Merkle verification, and durable verdict cards/feed. HTTP MCP mutation tools require bridge authorization except for the explicitly enabled public Testnet assessment mode.
- **Live with configured Testnet credentials:** checked x402 calls, exact settlement verification, receipt finalization, readback-confirmed receipt anchoring, paid reports, and the qualification decision path.
- **Account resolution:** `assess_account` accepts a `.cspr` name. AgentPay validates its active CSPR.name resolution, checks that any returned public key derives the returned account hash, and then reads the canonical account directly from Casper Mainnet.
- **Token evidence:** Casper RPC reads CEP-18 supply controls and total supply. CSPR.live adds holder count, top-holder concentration, package versions, and install height. CSPR.trade adds exact Mainnet pair and priced-liquidity observations. Any unavailable or unsupported source remains *not checked*; custom authority models and LP-holder concentration are not claimed.
- **Not claimed:** hosted CSPR.cloud settlement has not yet been exercised end to end, and AgentPay has no mainnet deployment.

The app ships no committed business-evidence rows and no invented payment or transaction receipts.

---

## Repository layout

```
apps/web                        Front end (React 19, Vite)
apps/report-api                 Evidence + x402 API (Express)
apps/mcp-server                 MCP server + HTTP bridge
packages/agent-pay-core         Deterministic trust rules and policy
contracts/agent-pay-registry    Casper Wasm registry contract (Rust)
scripts                         dev, smoke, x402 buyer, deploy + submission tooling
docs                            Capability boundary, architecture, and research notes
```

Runs on Casper Testnet. Verdicts are automated evidence, not financial advice: a receipt proves what the agent checked and that it decided, not that the answer is true.
