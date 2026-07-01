# AgentPay Live Capabilities

Date: 2026-06-29

This file is the maintained list of what AgentPay can do live right now. Update it whenever a capability moves between local, configured Testnet, partial, or deferred. A capability is "live" only if the runtime can execute it without committed business fixture rows, placeholder payment receipts, or invented Casper transaction hashes.

## Live Without Payment Credentials

| Capability | Status | Runtime path | Verification |
|---|---|---|---|
| Report API health check | Live | `GET /health` in `apps/report-api/src/app.ts` | `npm run smoke` waits for `/health` |
| Quote a live evidence dataset | Live | `GET /reports/quote` builds `agent-pay-live-*` from Casper RPC status/block and CSPR.trade MCP pair surface | `npm run smoke`; `quote_report` must return live source summaries |
| Quote a token-subject dataset | Partial live | `GET /reports/quote?subject=<package-hash>` validates the subject and builds token authority/holder/age records from runtime state | `apps/report-api/test/subjectEvidence.test.ts`; default runtime currently leaves unavailable token-risk facts as not checked |
| Surface x402 readiness | Live | `GET /reports/payment-status` checks asset/payee/facilitator configuration and facilitator `/supported` | `npm run smoke`; returns `ready` or an explicit configuration reason |
| Enforce x402 gate | Live | `POST /reports/buy/:quoteId` returns HTTP 402 plus x402 headers unless a valid runtime payment payload is supplied | `npm run smoke`; `buy_report` without payload must return `payment_required` |
| Verify Merkle proof | Live | `POST /reports/verify` re-derives the evidence root from the returned record/proof | `npm test`; web tamper test rejects changed facts |
| Render and share verdict cards | Local live | `POST /card`, `GET /card/:id.png`, `POST /feed/share`, `GET /feed` | `apps/report-api/test/card.test.ts` and web trust-share tests; storage is in memory |
| MCP tool surface | Live | HTTP and stdio MCP servers expose quote, status, buy, verify, record, and assess tools | `npm test`; `apps/mcp-server/test/stdio.test.ts` and `tools.test.ts` |

## Live With Configured Testnet Credentials

| Capability | Status | Required configuration | Verification |
|---|---|---|---|
| Release paid reports after x402 settlement | Proven on Testnet with self-hosted facilitator; live when configured | `X402_ASSET_PACKAGE_HASH`, `PAYEE_ADDRESS`, supported facilitator, valid `PAYMENT-SIGNATURE`, `CASPER_RPC_URL` | Proven settlement `36cec4739b3576b86c694cc710f54b7d00eb7403779e593b927ead053e939236`; `npm run smoke` accepts both ready and explicit missing config |
| Confirm settlement on Casper | Proven on Testnet with self-hosted facilitator; live when configured | Settlement must return a raw 64-hex Casper transaction/deploy hash and `CASPER_RPC_URL` must confirm it as executed | `apps/report-api/test/handlers.test.ts`; submission evidence tracks `AGENT_PAY_SETTLEMENT_TX_HASH` |
| Sign an x402 buyer payload | Live when configured | `CASPER_SECRET_KEY_PATH`, quote payment requirement, report API URL | `npm run x402:buy` |
| Check registry readiness | Live when configured | `AGENT_PAY_REGISTRY_PACKAGE_HASH`, executable record script, `CASPER_SECRET_KEY_PATH`, `casper-client`, `CASPER_RPC_URL` | `registry_status`; `npm run smoke`; `npm run submission:check` |
| Record decisions on Casper | Proven on Testnet; live when configured | Same registry config plus a verified dataset root, report hash, payment receipt hash, and policy decision | Proven decision `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`; submission evidence tracks `AGENT_PAY_DECISION_TX_HASH` |
| Full Trust Signal orchestration | Proven for one self-hosted Testnet paid run; live when configured | Report API, x402 buyer key, payment configuration, registry configuration | `assess_subject` quotes, pays, verifies every evidence leaf, scores, narrates, and records; hosted CSPR.cloud settlement is not yet proven end-to-end |
| Submission readiness audit | Live | Local env plus public GitHub/walkthrough URLs for final readiness | `npm run submission:check` |

## Partial Or Explicitly Limited

| Area | Current truth | Do not claim |
|---|---|---|
| Token risk intelligence | Default token-subject evidence validates package-hash shape and fetches live latest-block context, but mint authority, supply renouncement, holder count, holder concentration, LP holders, and liquidity depth are nullable unless a real token-state source is wired in. The policy reports those fields as not checked. | Do not claim broad token safety, complete mint-authority analysis, holder distribution analysis, or liquidity-depth analysis as live default behavior. |
| CSPR.trade evidence | The default live dataset queries CSPR.trade MCP for pair surface. If that source is unavailable, the API includes an unavailable record with a hashed error instead of inventing pair data. | Do not claim guaranteed CSPR.trade coverage for every token subject. |
| Feed/cards | Verdict card and feed routes are runtime features, but they are in-memory local process state. | Do not claim durable public feed storage. |
| Web ASK flow | The ASK page calls `assess_subject`, which requires the full configured x402 and registry path. | Do not claim the ASK flow completes on an unconfigured local checkout. |
| Registry contract | The repo builds and submits to `AgentPayRegistry`, and readiness verifies package-hash shape/RPC reachability. | Do not claim mainnet deployment or production monitoring. |
| Hosted CSPR.cloud facilitator | `X402_FACILITATOR_URL=https://x402-facilitator.cspr.cloud` is a supported configuration path, but the captured settlement evidence used the self-hosted open-source facilitator. | Do not claim hosted CSPR.cloud settlement has been exercised end-to-end until a hosted settlement hash is captured. |

## Deferred

- Complete token-state indexer for mint authority, supply renouncement, holders, top-holder percentage, LP holders, and liquidity depth.
- Wallet UX for generating payment payloads in the browser.
- Durable quote/feed storage.
- Mainnet deployment.
- Production monitoring and alerting.
- GhostGuard insurance/payout product.
