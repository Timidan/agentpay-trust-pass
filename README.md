# AgentPay Trust Pass

**A paid-evidence Trust Pass for Casper tokens and wallets.** AgentPay buys live on-chain evidence over the x402 payment rail, verifies it against a committed Merkle root, scores it with a deterministic policy, and records a **CLEAR / CAUTION / DANGER** verdict on the Casper blockchain. The result is a copyable receipt, not just an API response.

The Trust Pass is proof of *what the agent checked, paid for, verified, and decided*, on-chain. It is not proof that an answer is objectively true. Flags are automated evidence, not financial advice. Signals that cannot be read are reported as **not checked**, never guessed.

---

## What it does

Every check runs the same four-stop rail, always in order. Nothing unlocks early, and nothing is paid for blind.

```
  1. Quote            2. Settle x402         3. Verify              4. Record
  ---------           --------------         --------              --------
  Build a report      Pay the fee in CSPR    Re-derive the         Write the verdict,
  from live Casper    over x402; the         Merkle root from      report hash, and
  RPC + CSPR.trade    report stays behind    the released          receipt hash to the
  and commit a        HTTP 402 until a       evidence and match    AgentPayRegistry
  dataset root.       signed payload pays.   the quoted root.      contract on Casper.
```

A verdict is only trustworthy if you can re-run it. Because the dataset root is committed at quote time and the payment, proof, and decision are all on-chain, anyone can replay the check and confirm the desk reported what it actually observed.

### Three ways to use it

| Surface | Route / entry | What it does |
|---|---|---|
| **Token check** | web `/check` | Paste a token package hash, or a symbol resolved via CSPR.trade. Scores mint authority, holder concentration, and contract age against the token policy. |
| **Counterparty check** | web `/counterparty` | Paste a Casper account (account-hash or public key). Scores existence, CSPR balance, and key control against the account policy. |
| **Evidence desk** | web `/app` | An operator console that observes the rail: the live verdict, a numbered pipeline, the evidence checklist, the Merkle proof, and the on-chain receipt. |
| **Agent API** | MCP (stdio) + HTTP bridge | Autonomous agents drive the same rail with their own Casper keys. The web UI only observes; AgentPay never holds an agent's key. |

---

## Verdicts

Scoring is deterministic and lives in one pure package (`packages/agent-pay-core`). The same rule engine powers the web UI, the console, and the agent tools, so a verdict never depends on who asked.

| Verdict | Meaning |
|---|---|
| **CLEAR** | Every mandatory check that could run came back clean. |
| **CAUTION** | A soft flag fired, or a mandatory check could not run this time. |
| **DANGER** | A hard risk showed up (for example, mint authority still open, or no account at the address). |

Each result carries three signal-backed lists: **flags** (what fired, with severity), **passed** (mandatory checks that ran clean), and **not checked** (mandatory signals that could not be read this run). The desk does not fabricate a clean check it did not perform.

---

## Architecture

An npm-workspaces monorepo. Each layer is independently testable.

```
apps/web                       React 19 + Vite front end (landing, token check, wallet check, feed, agent docs, console)
apps/report-api                Express evidence + x402 API (quote, 402 gate, verify, resolve, cards/feed)
apps/mcp-server                MCP server over stdio + an HTTP bridge; exposes the rail as agent tools
packages/agent-pay-core        Pure, deterministic trust rules and policy (no network, no keys)
contracts/agent-pay-registry   Rust/Wasm Casper contract that records verdicts against a dataset root
```

The core is dependency-injected and has no network or key access, which is why the policy is unit-testable without a chain. The layers above wire in the real Casper RPC, the x402 facilitator, and the registry submitter.

---

## Quickstart

Requires **Node.js >= 22.12**. Building the contract additionally needs a Rust toolchain and `binaryen` (see [Deploying to Casper Testnet](#deploying-to-casper-testnet)).

```bash
npm install
npm run dev      # report-api on :4021, mcp bridge on :3001, web on :5173
```

Open http://localhost:5173 and try a token check. Without payment credentials configured, the rail runs up to the x402 wall and stops with an honest "signing key not configured" message. That is the expected local behavior: reading evidence and quoting is free, but settling the fee to buy the evidence and record a verdict needs a funded Casper key.

```bash
npm test         # workspace unit tests + script tests + the Rust contract tests
npm run build    # build every workspace + the registry Wasm
npm run smoke    # boot the report API and probe the live capability surface
```

---

## Agent integration

Agents talk to AgentPay over MCP (stdio) or the HTTP bridge and act with their own Casper keys. Add the MCP server to any MCP-capable client:

```json
{
  "mcpServers": {
    "agent-pay": {
      "command": "pnpm",
      "args": ["--filter", "@agent-pay/mcp-server", "stdio"],
      "env": {
        "REPORT_API_URL": "http://127.0.0.1:4021",
        "AGENT_PAY_PUBLIC_ORIGIN": "http://127.0.0.1:4021"
      }
    }
  }
}
```

Or call the HTTP bridge directly: `POST http://127.0.0.1:4021/tools/<name>`.

### Tools

| Tool | Purpose |
|---|---|
| `quote_report` | Returns price, expiry, dataset root, payment resource, and x402 requirements for a subject (token package hash or Casper account). |
| `payment_status` | Reports x402 readiness (asset, payee, facilitator, network). |
| `registry_status` | Reports registry readiness (package hash, submitter, RPC). |
| `buy_report` | Replays the quote with a signed x402 `PAYMENT-SIGNATURE` payload and unlocks the report. |
| `verify_report` | Checks the released report and Merkle proof against the quoted dataset root. |
| `record_decision` | Writes `approved` / `needs_review` / `rejected` to the Casper registry. |
| `assess_subject` | Runs the full rail in one call for a token: quote, pay, verify, score, narrate, record. |
| `assess_account` | The counterparty check: the same rail scoped to a Casper account. |

`payment_status` and `registry_status` are deliberately separate from the mutation tools, so an agent can detect missing Casper configuration before attempting settlement or a registry write. The signing key stays with the agent: generate a buyer payload with `npm run x402:buy` against a quote, then hand it to `buy_report`.

---

## Configuration

Reading evidence and quoting need no credentials. Settling payments and recording verdicts need a configured Casper environment (set via process env or a local `.env`; nothing secret is committed):

| Variable | Used for |
|---|---|
| `CASPER_RPC_URL` | Reading chain state and confirming transactions. |
| `CASPER_SECRET_KEY_PATH` | The buyer/submitter key that signs x402 payments and records decisions. |
| `X402_ASSET_PACKAGE_HASH` | The CEP-18 fee asset, as raw 64 hex chars. |
| `PAYEE_ADDRESS` | The account that receives payment, in `00<64 hex>` form. |
| `X402_FACILITATOR_URL` | The x402 facilitator. The proven path is the self-hosted open-source `casper-x402`; hosted CSPR.cloud is a drop-in option (add `CSPR_CLOUD_ACCESS_TOKEN` or `X402_FACILITATOR_AUTH_TOKEN`). |
| `AGENT_PAY_REGISTRY_PACKAGE_HASH` | The deployed AgentPayRegistry, as `hash-<64 hex>` or raw 64 hex chars. |

AgentPay uses x402 V2 headers: the report API returns `PAYMENT-REQUIRED`, the buyer agent retries with `PAYMENT-SIGNATURE`, and a settled response includes `PAYMENT-RESPONSE`. A paid report is only released after facilitator verification, a raw 64-hex settlement hash, and an `info_get_transaction` confirmation that the hash executed.

---

## x402 buyer

The buyer agent that produces the `PAYMENT-SIGNATURE` lives in [scripts/x402-buyer.ts](scripts/x402-buyer.ts) (signing) and [scripts/x402-buy.ts](scripts/x402-buy.ts) (CLI). It builds the EIP-712 `TransferWithAuthorization` digest with the official `@casper-ecosystem/casper-eip-712` package and signs it with the exact Casper x402 scheme the facilitator verifies (secp256k1: `0x02 || ECDSA(sha256(digest))`; ed25519: `0x01 || ed25519(digest)`).

```bash
REPORT_API_URL=http://127.0.0.1:4021 \
AGENT_PAY_SUBJECT=hash-<64-hex-package-hash> \
CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem \
npm run x402:buy
```

It quotes live evidence, signs the payment authorization, retries `buy_report` with `PAYMENT-SIGNATURE`, and prints the released report plus the confirmed settlement transaction, or the exact missing x402 configuration if the report API is not fully configured.

---

## Deploying to Casper Testnet

Build the AgentPayRegistry Wasm:

```bash
npm run build:contract
```

This is not a plain `cargo build`. Casper's Wasm engine rejects the `bulk-memory` operations recent Rust toolchains emit by default, so [`build-contract.sh`](contracts/agent-pay-registry/scripts/build-contract.sh) recompiles `core`/`alloc` with those features disabled (`-Z build-std`), then lowers the residual `sign-ext`/nontrapping-fptoint operators back to MVP with `wasm-opt`. It requires **binaryen** (`wasm-opt`) on `PATH` (`npm i -g binaryen`) and fails loudly if any non-MVP opcode survives.

Create and fund a Testnet key (the generated directory is git-ignored):

```bash
cargo install casper-client
casper-client keygen .agentpay-testnet-key
npm run submission:funding   # prints the account address, balance, and faucet link
```

Fund the printed account (faucet: https://testnet.cspr.live/tools/faucet), then point `CASPER_SECRET_KEY_PATH` at `.agentpay-testnet-key/secret_key.pem`. Deploy and capture the install/package hashes:

```bash
npm run submission:deploy-registry
```

The registry contract (`contracts/agent-pay-registry/src/contract.rs`) exposes `record_decision_with_root` and `get_dataset_root`. Readiness and evidence tooling (`npm run submission:check`, `submission:evidence`, `submission:proof`) audit the full paid path end to end. Never paste private key material into env files, chat, docs, or source.

---

## Proven on Casper Testnet

One full settle-verify-record run has been captured live using the self-hosted `casper-x402` facilitator:

- Registry package: `hash-73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97`
- x402 settlement tx: `36cec4739b3576b86c694cc710f54b7d00eb7403779e593b927ead053e939236`
- Decision record tx: `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`

---

## Honesty and boundaries

The maintained, authoritative list of what runs live today is [docs/live-capabilities.md](docs/live-capabilities.md). Treat it as the product boundary before adding a claim anywhere. In short:

- **Live without credentials:** health, live evidence quoting, x402 readiness, the 402 gate, Merkle verification, verdict cards and feed (in-memory), and the full MCP tool surface.
- **Live with configured Testnet credentials:** buying reports after x402 settlement, confirming settlement on-chain, checking registry readiness, and recording decisions. Proven for one self-hosted Testnet run.
- **Not claimed:** broad token-risk analysis is not default behavior. Mint authority, holder distribution, and liquidity depth are reported as *not checked* unless a real token-state source is wired in. The feed is in-memory, hosted CSPR.cloud settlement is not yet exercised end to end, and there is no mainnet deployment.

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

Status: buildathon project on Casper Testnet. Verdicts are automated evidence, not financial advice. The stamp means proof of what the agent checked and that it decided, not proof the answer is true.
