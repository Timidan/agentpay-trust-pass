# AgentPay user surfaces

Every way a person or an agent can use AgentPay, what each surface is for, and
what access it needs. The hosted deployment lives at
[agentpay.timidan.xyz](https://agentpay.timidan.xyz); everything below also runs
locally (see [Local development](../README.md#local-development)).

## Web pages

Every page shares the same header (links to all pages, current page highlighted)
and footer, so each surface is reachable from every other. The landing page has
its own brand chrome; all pages honor the light/dark theme toggle and
`prefers-reduced-motion`.

| Route | Name | What it does | Access needed |
|---|---|---|---|
| `/` | Landing | Explains the product: the check → sign → verify → receipt flow, live service status read from the public APIs, and entry points to every other surface. | None |
| `/audit` | Payment checker | The flagship flow. Capture a real x402 charge (AgentPay's own Testnet charge or any HTTPS x402 service URL), get a PAY / REVIEW / BLOCK decision with reasons, sign locally, settle, verify the Casper transfer matches the approved terms, and record an anchored receipt. Eight steps with an honest progress track. | Casper Wallet (sign a login message) or a pasted AgentPay token |
| `/check` | Token check | Paid check on a Casper token by symbol or package hash (Mainnet or Testnet evidence). Returns a Clear / Caution / Danger verdict listing what passed, what failed, and what could not be checked, plus a receipt. | None — the hosted check covers the Testnet fee |
| `/counterparty` | Wallet check | Paid check on a Casper account by CSPR.name, account hash, or public key: existence, funding, and key-control setup. Same verdict model as the token check. | None — the hosted check covers the Testnet fee |
| `/feed` | Shared results | Check results whose owners chose to publish them, each linking to its shareable card image. Explicitly not a full history. | None |
| `/agents` | Agent integration | The developer onboarding page: MCP server config, tool list, HTTP bridge quickstart, and the fetchable `skill.md` integration guide. | None to read |
| `/app` | Evidence console | The raw evidence rail: quote → x402 settlement → Merkle proof verification → registry record, with live agent-bridge activity and a "tamper one fact" demo that shows proof verification failing. | Runs against the live services; the x402 step needs a buyer payload from the CLI |

## Developer and agent surfaces

| Surface | Entry | What it does |
|---|---|---|
| CLI | `npm install -g @timidan/agentpay-cli` → `agentpay` | Sessions, scoped agent tokens, payment checks, one-shot checked calls, settlement verification, policy and provider management, receipt show/verify (works offline for `receipt verify`). Defaults to the hosted API; `--api-url` targets any deployment. |
| MCP server | `npx --yes @timidan/agentpay-mcp` (stdio) | Exposes the [tools](../README.md#tools) (`check_x402_payment`, `verify_x402_settlement`, `get_payment_receipt`, `assess_subject`, `assess_account`, `payment_status`, `registry_status`, and the report tools) to any MCP-capable agent. It defaults to the hosted API; config sample on `/agents`. |
| HTTP bridge | `POST <origin>/bridge/tools/<name>` with a bearer bridge token | The same tools over plain HTTP for agents without MCP. `payment_status` and `registry_status` are public; assessments can be opened up per deployment (`MCP_PUBLIC_TESTNET_ASSESSMENTS=1` with an origin allowlist and budgets). |
| TypeScript client | `@agent-pay/client` (workspace package) | Programmatic capture → check → sign-after-PAY → settle → verify, used by the web app and CLI. Not yet published to npm; consumed from the monorepo. |
| Report API | `<origin>/api` | The REST substrate everything above talks to: quotes, x402-gated report purchase, proof verification, registry records, the shared-results feed, card images, and the auditor routes. |
| Skill guide | `curl <origin>/api/skill.md` | A self-contained integration guide an agent can fetch and follow (`skill://agentpay`). |

## Who needs which credential

| Credential | How you get it | What it unlocks |
|---|---|---|
| Nothing | — | Landing, token check, wallet check, shared results, agent docs, public status tools. |
| Casper Wallet login | Sign a one-time challenge in the browser (no transaction, no registration) | The payment checker (`/audit`) end to end. |
| Operator session token | `agentpay session create --key <secret.pem>` — proof of key control, short-lived, key never leaves your machine | Everything the wallet login unlocks, plus policy/provider management and agent-token issuance. Any Casper keypair qualifies; there is no allowlist. |
| Scoped agent token | `agentpay agent-token issue` (requires an operator session) | Limited authority for an autonomous agent: explicit scopes (e.g. `checks:write`) and an allowed-payer list. |
| Bridge token | Deployment config (`MCP_SERVER_AUTH_TOKEN`) | Privileged tools over the HTTP bridge. Separate from AgentPay API tokens. |

Signing is always local. No surface — web, CLI, MCP, or bridge — ever receives a
private key, and approval is never payment: nothing settles until the buyer's
own wallet signs.
