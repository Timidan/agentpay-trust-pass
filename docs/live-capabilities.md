# AgentPay Live Capabilities

Date: 2026-07-16

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

## Payment Auditor

| Capability | Status | Runtime path | Verification |
|---|---|---|---|
| Check an x402 charge before signing | Live | `POST /v1/checks` normalizes the 402 terms, binds the original request and optional authorization, loads Casper token evidence, and returns PAY / REVIEW / BLOCK | Deterministic core tests plus authenticated report API route tests |
| Enforce operator policy and provider records | Live | Casper-signed challenges install versioned policy, agent-token scopes, and PIN / DENY records; spend reservations and authorization nonces are durable | Report API auth, policy, repository, concurrency, and restart tests |
| Verify an exact Casper settlement | Proven on Testnet | `POST /v1/checks/:id/verify-settlement` reads `info_get_transaction` and compares network, asset, payer, payee, amount, authorization digest, execution, and finality | Fixture matrix plus checked-call settlement `2491e2cfc3fc2c299ebdfb25725a8c8a194918b813f8c7596eec13bce3cd7911` |
| Issue and verify purchase receipts | Live | A response observation finalizes one immutable receipt; `GET /v1/receipts/:id` returns it with dynamic anchor state; receipt hashes verify offline | Core receipt tamper tests, report API routes, CLI `receipt verify`, and shared-client tests |
| Non-custodial checked call | Live | `@agent-pay/client` captures a service 402, asks AgentPay, signs only after PAY, retries payment, polls settlement, observes a bounded response, and returns a receipt | Shared-client integration test runs the complete local HTTP sequence with a real local Casper signer |
| Developer CLI | Live | `agentpay check`, `verify-settlement`, `call`, policy/provider controls, and receipt show/verify | Spawned CLI tests cover all decisions, settlement outcomes, signed controls, credential redaction, and full checked call |
| Agent MCP tools | Live | `check_x402_payment`, `verify_x402_settlement`, and `get_payment_receipt` use scoped API tokens and never receive a local signing key | MCP HTTP and stdio suites; receipt tool includes current anchor state |

## Live With Configured Testnet Credentials

| Capability | Status | Required configuration | Verification |
|---|---|---|---|
| Release paid reports after x402 settlement | Proven on Testnet with self-hosted facilitator; live when configured | `X402_ASSET_PACKAGE_HASH`, `PAYEE_ADDRESS`, supported facilitator, valid `PAYMENT-SIGNATURE`, `CASPER_RPC_URL` | Complete checked purchase settled in `2491e2cfc3fc2c299ebdfb25725a8c8a194918b813f8c7596eec13bce3cd7911`; `npm run smoke` accepts both ready and explicit missing config |
| Confirm settlement on Casper | Proven on Testnet with self-hosted facilitator; live when configured | Settlement must return a raw 64-hex Casper transaction/deploy hash and `CASPER_RPC_URL` must confirm it as executed | `apps/report-api/test/handlers.test.ts`; submission evidence tracks `AGENT_PAY_SETTLEMENT_TX_HASH` |
| Sign an x402 buyer payload | Live when configured | `CASPER_SECRET_KEY_PATH`, quote payment requirement, report API URL | `npm run x402:buy` |
| Check registry readiness | Live when configured | v2 package and contract hashes, executable record script, dedicated recorder account/key, `casper-client`, and `CASPER_RPC_URL` | `registry_status`; `npm run smoke`; `npm run submission:check` |
| Record decisions on Casper | Proven on Testnet; live when configured | Same registry config plus a verified dataset root, report hash, payment receipt hash, and policy decision | Proven decision `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`; submission evidence tracks `AGENT_PAY_DECISION_TX_HASH` |
| Full Trust Signal orchestration | Proven for one self-hosted Testnet paid run; live when configured | Report API, x402 buyer key, payment configuration, registry configuration | `assess_subject` quotes, pays, verifies every evidence leaf, scores, narrates, and records; hosted CSPR.cloud settlement is not yet proven end-to-end |
| Submission readiness audit | Live | Local env plus public GitHub/walkthrough URLs for final readiness | `npm run submission:check` |
| Anchor finalized receipt hashes | Proven on Testnet | v2 package `hash-050b717617b9c79535983d9e0cc2ba21dd379ce3450498601dba64324a2dcd1a`, contract `hash-b5e129dca5548f1bbe225db73042d08ab5b35cc976c3ac955bf2fe2a8cd92ee3`, and dedicated recorder key | Install `2c53ec7d38757c7c252fa16acc4c099d1c53136c852f908821989ac42f0fa4e6`; readback-confirmed anchor `eb30265877e0bbb549efa6f09dbd8beb29efc31191724ce082fca45b6dddddfc` stores receipt `0f253ef7ce564e046d23abf42c8cabdad7b1deeab2fa4fafd2e3619f93cdf231` |

## Partial Or Explicitly Limited

| Area | Current truth | Do not claim |
|---|---|---|
| Token risk intelligence | Default token-subject evidence validates package-hash shape and fetches live latest-block context, but mint authority, supply renouncement, holder count, holder concentration, LP holders, and liquidity depth are nullable unless a real token-state source is wired in. The policy reports those fields as not checked. | Do not claim broad token safety, complete mint-authority analysis, holder distribution analysis, or liquidity-depth analysis as live default behavior. |
| CSPR.trade evidence | The default live dataset queries CSPR.trade MCP for pair surface. If that source is unavailable, the API includes an unavailable record with a hashed error instead of inventing pair data. | Do not claim guaranteed CSPR.trade coverage for every token subject. |
| Feed/cards | Verdict card and feed routes are runtime features, but they are in-memory local process state. | Do not claim durable public feed storage. |
| Web ASK flow | The ASK page calls `assess_subject`, which requires the full configured x402 and registry path. | Do not claim the ASK flow completes on an unconfigured local checkout. |
| Registry deployment scope | The access-controlled v2 receipt registry is live on Casper Testnet as a separate package so it can coexist with the qualification contract. It is not deployed on mainnet. | Do not describe the v2 Testnet package as a mainnet deployment or as an in-place upgrade of the qualification package. |
| Hosted CSPR.cloud facilitator | `X402_FACILITATOR_URL=https://x402-facilitator.cspr.cloud` is a supported configuration path, but the captured settlement evidence used the self-hosted open-source facilitator. | Do not claim hosted CSPR.cloud settlement has been exercised end-to-end until a hosted settlement hash is captured. |

## Deferred

- Complete token-state indexer for mint authority, supply renouncement, holders, top-holder percentage, LP holders, and liquidity depth.
- Wallet UX for generating payment payloads in the browser.
- Durable quote/feed storage.
- Mainnet deployment.
- Production monitoring and alerting.
- GhostGuard insurance/payout product.
