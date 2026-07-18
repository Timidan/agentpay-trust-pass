# AgentPay Live Capabilities

Date: 2026-07-18

This file is the maintained list of what AgentPay can do live right now. Update it whenever a capability moves between local, configured Testnet, partial, or deferred. A capability is "live" only if the runtime can execute it without committed business fixture rows, placeholder payment receipts, or invented Casper transaction hashes.

## Live Without Payment Credentials

| Capability | Status | Runtime path | Verification |
|---|---|---|---|
| Report API health check | Live | `GET /health` in `apps/report-api/src/app.ts` | `npm run smoke` waits for `/health` |
| Quote a live evidence dataset | Live | `GET /reports/quote` builds `agent-pay-live-*` from Casper RPC status/block and CSPR.trade MCP pair surface | `npm run smoke`; `quote_report` must return live source summaries |
| Quote a token-subject dataset | Live with public indexed and native evidence | `GET /reports/quote?subject=<package-hash>` combines Casper RPC contract state and total supply with public CSPR.live holder ownership, concentration, package versions, and install height. Mainnet checks also include CSPR.trade pair observations. | Source-shape, no-credential, partial-failure, and provenance coverage in `apps/report-api/test/csprCloud.test.ts` and `subjectEvidence.test.ts`; real WCSPR pipeline check on 2026-07-17 |
| Resolve a CSPR.name account | Live on Mainnet | `GET /resolve-account?name=<name.cspr>` validates the active CSPR.name response, expiry, account hash, and public-key/account-hash match before an account check | Resolver and HTTP-route tests plus the live `alice.cspr` smoke in `verify-live-e2e.ts` |
| Surface x402 readiness | Live | `GET /reports/payment-status` checks asset/payee/facilitator configuration and facilitator `/supported` | `npm run smoke`; returns `ready` or an explicit configuration reason |
| Enforce x402 gate | Live | `POST /reports/buy/:quoteId` returns HTTP 402 plus x402 headers unless a valid runtime payment payload is supplied | `npm run smoke`; `buy_report` without payload must return `payment_required` |
| Verify Merkle proof | Live | `POST /reports/verify` re-derives the evidence root from the returned record/proof | `npm test`; web tamper test rejects changed facts |
| Render and share verdict cards | Durable live | `POST /card`, `GET /card/:id.png`, `POST /feed/share`, `GET /feed`; opt-in cards/feed use the same persistent SQLite volume as the auditor | Restart, retention, idempotency, and route coverage in `publicArtifacts.test.ts` and `feed.test.ts` |
| MCP tool surface | Live with deployment controls | Stdio exposes all tools; HTTP supports bearer protection plus an optional origin-restricted, rate-limited, daily-capped Testnet public mode for `assess_subject` and `assess_account` only | MCP HTTP/stdio suites plus `bridge-errors.test.ts` and `publicAccess.test.ts` |

## Payment Auditor

| Capability | Status | Runtime path | Verification |
|---|---|---|---|
| Check an x402 charge before signing | Live | `POST /v1/checks` normalizes the 402 terms, binds the original request and optional authorization, loads Casper token evidence, and returns PAY / REVIEW / BLOCK | Deterministic core tests plus authenticated report API route tests |
| Enforce operator policy and provider records | Live | Casper-signed challenges install versioned policy, agent-token scopes, and PIN / DENY records; spend reservations and authorization nonces are durable | Report API auth, policy, repository, concurrency, and restart tests |
| Verify an exact Casper settlement | Proven on Testnet | `POST /v1/checks/:id/verify-settlement` reads `info_get_transaction` and compares network, asset, payer, payee, amount, authorization digest, execution, and finality | Fixture matrix plus current checked-call settlement `91cdc628a732736e55a1b7880787257bf89ebf44f768859918dfa5bf108d416f` |
| Issue and verify purchase receipts | Live | A response observation finalizes one immutable receipt; `GET /v1/receipts/:id` returns it with dynamic anchor state; receipt hashes verify offline | Core receipt tamper tests, report API routes, CLI `receipt verify`, and shared-client tests |
| Non-custodial checked call | Live | The browser wallet and `@agent-pay/client` capture a service 402, ask AgentPay, sign only after PAY, retry payment, poll settlement, observe a bounded response, and return a receipt | Shared-client integration plus live desktop and mobile Casper Wallet E2E runs; hosted-WCSPR settlements `28048959f0e059dbc4b0b69f0d99d41bdcd19e05b72128fbbf0442ac3c185c98` and `e5b5bd3cb72347246de27979f889ca62c66503696ab16e5cc3cc99cd89130b69` |
| Developer CLI | Live | `agentpay session create`, agent-token lifecycle, `check`, `verify-settlement`, `call`, policy/provider controls, and receipt show/verify | 14 spawned CLI tests cover signed sessions, scoped token issue/list/revoke, all decisions, settlement outcomes, credential redaction, and a full checked call |
| Agent MCP tools | Live | `check_x402_payment`, `verify_x402_settlement`, and `get_payment_receipt` use scoped API tokens and never receive a local signing key | MCP HTTP and stdio suites; receipt tool includes current anchor state |

## Live With Configured Testnet Credentials

| Capability | Status | Required configuration | Verification |
|---|---|---|---|
| Release paid reports after x402 settlement | Proven on Testnet with hosted CSPR.cloud facilitator; live when configured | Official WCSPR package, `PAYEE_ADDRESS`, facilitator authorization, valid `PAYMENT-SIGNATURE`, `CASPER_RPC_URL` | Hosted paid report released after settlement `31d7fb7fe45430d4af99c56e9dda536ce4c7306c0296f3d87fc0febd771adb86`; `npm run smoke` accepts both ready and explicit missing config |
| Confirm settlement on Casper | Proven on Testnet with hosted CSPR.cloud facilitator; live when configured | Settlement must return a raw 64-hex Casper transaction/deploy hash and `CASPER_RPC_URL` must confirm it as executed | Hosted settlement `31d7fb7fe45430d4af99c56e9dda536ce4c7306c0296f3d87fc0febd771adb86` executed at block 8,548,043 with the exact payer, payee, and `10000` WCSPR amount |
| Sign an x402 buyer payload | Live when configured | `CASPER_SECRET_KEY_PATH`, quote payment requirement, report API URL | `npm run x402:buy` |
| Check registry readiness | Live when configured | v2 package and contract hashes, executable record script, dedicated recorder account/key, `casper-client`, and `CASPER_RPC_URL` | `registry_status`; `npm run smoke`; `npm run submission:check` |
| Record decisions on Casper | Proven on Testnet; live when configured | Same registry config plus a verified dataset root, report hash, payment receipt hash, and policy decision | Proven decision `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`; submission evidence tracks `AGENT_PAY_DECISION_TX_HASH` |
| Full paid-check orchestration | Proven with hosted CSPR.cloud on Testnet; live when configured | Report API, x402 buyer key, official WCSPR payment configuration, registry configuration | A signed quote passed `/verify`, `/settle`, exact on-chain confirmation, and paid-report release in settlement `31d7fb7fe45430d4af99c56e9dda536ce4c7306c0296f3d87fc0febd771adb86` |
| Full payment-auditor checked call | Proven on Testnet | Scoped agent token, signed provider policy, buyer key held by the CLI/client, report API, and target x402 service | Live desktop and mobile runs reached PAY only after policy and payment preparation, then returned `match`, recorded the response, and anchored receipts in `ad6dfb831d4fb8273d8c54d41ea9e2ad48e1d94aea18b94006ee3b94a7470b87` and `eb557178a60c5b06ecf10ea3efb5d8c4e0a236fec6c4a7f8da826d33c94fdb1d` |
| Submission readiness audit | Live | Local env plus public GitHub/walkthrough URLs for final readiness | `npm run submission:check` |
| Anchor finalized receipt hashes | Proven on Testnet | v2 package `hash-050b717617b9c79535983d9e0cc2ba21dd379ce3450498601dba64324a2dcd1a`, contract `hash-b5e129dca5548f1bbe225db73042d08ab5b35cc976c3ac955bf2fe2a8cd92ee3`, and dedicated recorder key | Install `2c53ec7d38757c7c252fa16acc4c099d1c53136c852f908821989ac42f0fa4e6`; readback-confirmed anchor `eb30265877e0bbb549efa6f09dbd8beb29efc31191724ce082fca45b6dddddfc` stores receipt `0f253ef7ce564e046d23abf42c8cabdad7b1deeab2fa4fafd2e3619f93cdf231` |

## Partial Or Explicitly Limited

| Area | Current truth | Do not claim |
|---|---|---|
| Token risk intelligence | Casper RPC reads supply controls and total supply; public CSPR.live supplies holder count, top-holder concentration, package versions, and install height; CSPR.trade supplies descriptive Mainnet pair and priced-liquidity observations. Each source fails independently. Custom authority models and LP-holder concentration remain unavailable. | Do not claim universal token safety, complete DEX analysis, support for every custom token authority model, or that a missing public mint entry point proves every possible upgrade/admin path is harmless. |
| CSPR.trade evidence | The default live dataset queries CSPR.trade MCP for pair surface. If that source is unavailable, the API includes an unavailable record with a hashed error instead of inventing pair data. | Do not claim guaranteed CSPR.trade coverage for every token subject. |
| Paid-report quote lifetime | Paid-evidence quotes and their short-lived settlement cache are process-local and capped; durable auditor checks and purchase receipts are separate SQLite records. | Do not promise that an unpaid five-minute evidence quote survives a report API restart. |
| Web ASK flow | The ASK page calls `assess_subject`, which requires the full configured x402 and registry path. | Do not claim the ASK flow completes on an unconfigured local checkout. |
| Registry deployment scope | The access-controlled v2 receipt registry is live on Casper Testnet as a separate package so it can coexist with the qualification contract. It is not deployed on mainnet. | Do not describe the v2 Testnet package as a mainnet deployment or as an in-place upgrade of the qualification package. |
| Hosted facilitator dependency | CSPR.cloud `/supported`, `/verify`, and `/settle` are exercised end to end with official Testnet WCSPR. Live availability and rate limits remain external dependencies, and sustained traffic needs a project-specific credential. | Do not claim a facilitator availability SLA, unlimited use of the documentation credential, or mainnet settlement. |

## Deferred

- LP-holder and liquidity-depth evidence when a reliable Testnet pool/indexer source exists.
- Durable short-lived paid-report quote storage if multi-instance operation is introduced.
- Mainnet deployment.
- Production monitoring and alerting.
- GhostGuard insurance/payout product.
