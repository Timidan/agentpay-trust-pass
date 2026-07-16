# AgentPay Real Product Constraints

Date: 2026-07-16

## Product Rule

AgentPay must show evidence produced by runtime interaction with Casper ecosystem products. The repository must not carry committed business evidence rows that make the app look complete without live integrations.

Current runtime source set:

- Casper Node RPC: network status and latest finalized block from `CASPER_RPC_URL`.
- Token-subject evidence: package-hash validation plus live latest-block context from `CASPER_RPC_URL`; mint authority, supply renouncement, holder distribution, LP holders, and liquidity depth remain not checked until a real token-state source is wired in.
- CSPR.trade MCP: DEX pair surface from `CSPR_TRADE_MCP_URL`.
- x402 facilitator: payment verification and settlement through `X402_FACILITATOR_URL`, using `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers. The proven Testnet run used the self-hosted open-source `casper-x402` facilitator at `http://127.0.0.1:4022`; the hosted CSPR.cloud facilitator remains an optional drop-in path that has not been exercised end-to-end in this repo.
- Payment auditor: authenticated `/v1/checks` evaluates normalized x402 terms before signing; the API stores no buyer key and cannot submit a buyer payment.
- Settlement verifier: Casper `info_get_transaction` evidence is matched against the exact approved payer, payee, asset, amount, network, and authorization before one immutable receipt can be finalized.
- AgentPayRegistry submitters: the qualified decision path uses an owner or recorder account; the purchase-receipt path uses only `AGENT_PAY_REGISTRY_RECORDER_KEY_PATH` and refuses reuse of `CASPER_SECRET_KEY_PATH`.
- AgentPayRegistry readiness: separate status for the qualified decision path and hardened receipt anchors, including package hash, active contract hash, dedicated recorder key, script policy, `casper-client`, and RPC reachability.

If a required service is not configured, AgentPay must surface that state directly. It must not invent receipts, transactions, or settled payments.

The maintained live capability ledger is [live-capabilities.md](live-capabilities.md). Product, UI, README, and submission claims must not exceed that ledger.

## Current Buildathon Context

Verified on 2026-06-10 from DoraHacks search results, Casper AI Toolkit coverage, CSPR.trade MCP docs, and the current submission grid supplied in the workspace.

Hard constraints:

- Qualification round is on DoraHacks for the Casper Agentic Buildathon 2026.
- Prize pool is listed as $150,000.
- The buildathon focus is agentic AI using Casper x402 payments, MCP, DeFi/payments, cross-chain, and RWA tokenization.
- Casper AI Toolkit messaging emphasizes live x402 payments, MCP access, CSPR.trade MCP, Odra smart contract workflows, and CSPR.cloud APIs.

Current competitor clusters:

- DeFi agents: Casper DiFi Agent, Agent Casper, OpenStat, Phoenix Zero.
- x402/payment infrastructure: AgentPay, x402 Crypto API, AgentPay-x402, AiFinPay, AgentPay Guard.
- RWA/oracle/trust agents: CasperRWA-Agent, Casper RWA Oracle, Asasanta Trust Agent.
- Broader agent platforms: Arbit, Clawintel, Chainleash, Nyxora AI, credmesh.xyz, Kawi, MemeEco, EffortXq.

AgentPay positioning:

- Not another trading agent.
- Not another generic payment API.
- Product thesis: AgentPay checks a Casper x402 charge before the buyer signs, then proves that the executed transfer and service response matched the approved terms.

Complexity bar:

- Stronger than a thin UI over one API because it spans live source ingestion, payment gating, proof verification, MCP tools, and an on-chain decision boundary.
- Strongest when presented as a non-custodial pre-payment checker: the current evidence includes a real checked x402 purchase, exact settlement verification, an immutable response receipt, and readback-confirmed receipt anchoring on Casper Testnet.

Iteration comparison on 2026-06-10:

- Search-indexed DoraHacks data now surfaces AgentPay as a machine-to-machine commerce/x402 submission, reinforcing that AgentPay cannot compete as payment plumbing alone and must emphasize paid evidence plus verifiable trust records.
- Search-indexed DoraHacks data also surfaces Agent Casper as autonomous DeFi portfolio management, reinforcing that AgentPay should not become a trading agent clone.
- AgentPay's differentiation remains the paid evidence and trust-record layer: quote live Casper product data, release only after x402 settlement, verify the exact evidence root, then submit that root and decision to Casper.
- This iteration tightens the Casper decision path by requiring `datasetRoot` and by confirming the returned transaction/deploy hash through Casper JSON-RPC before AgentPay treats the registry write as recorded.
- The UI now supports a two-stage runtime settlement path: quote live evidence first, then continue the same quote with a real x402 payment payload. No payment stand-in is committed to the repo.
- This iteration aligns AgentPay with the official x402 V2 HTTP contract and CSPR.cloud's Casper facilitator shape: `scheme: "exact"`, CAIP-2 Casper network IDs, CEP-18 package-hash assets, base-unit amounts, and facilitator `/verify` then `/settle`.
- Current DoraHacks search results still show competing x402/payment submissions, including AgentPay and x402 Crypto API for Casper, so AgentPay's winning bar remains the full workflow rather than payment plumbing alone.
- This iteration adds explicit AgentPay payment readiness: the app and MCP bridge check asset/payee/facilitator configuration and the facilitator `/supported` network list before advertising accepted payment requirements. That keeps AgentPay from looking complete when the Casper x402 path is not actually usable.
- This iteration adds explicit AgentPay registry readiness: the app and MCP bridge check whether the real Casper decision-recording path is configured and whether the Casper RPC boundary responds before presenting the registry write as ready.
- This iteration tightens AgentPay registry readiness by rejecting malformed registry package hashes before any Casper RPC check or submitter call. Accepted forms are `hash-<64 hex chars>` and raw `64 hex chars`.
- This iteration tightens AgentPay x402 readiness by rejecting malformed payee account hashes before any facilitator check. Accepted payees use the CSPR.cloud x402 `00<64 hex chars>` account-hash form.
- This iteration tightens AgentPay settlement integrity by refusing to release paid evidence unless facilitator settlement returns a Casper transaction/deploy hash in raw `64 hex chars` form and Casper JSON-RPC confirms executed `info_get_transaction` results.
- This iteration tightens AgentPay registry integrity by refusing to return a decision receipt while Casper JSON-RPC still reports an empty `execution_info` response.
- This iteration replaces the registry deployment placeholder with a buildable `agent_pay_registry_contract.wasm` target and concrete `casper-client put-deploy` scripts for installation and `record_decision_with_root` calls.
- Current Testnet evidence includes registry v2 package `hash-050b717617b9c79535983d9e0cc2ba21dd379ce3450498601dba64324a2dcd1a`, install `2c53ec7d38757c7c252fa16acc4c099d1c53136c852f908821989ac42f0fa4e6`, checked x402 settlement `2491e2cfc3fc2c299ebdfb25725a8c8a194918b813f8c7596eec13bce3cd7911`, receipt anchor `eb30265877e0bbb549efa6f09dbd8beb29efc31191724ce082fca45b6dddddfc`, and the qualification decision record `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`.
- This iteration adds `npm run submission:check`, a local readiness audit that remains red until required Testnet, x402, reachable GitHub/walkthrough evidence is present and Casper hashes are confirmed as executed.

## MVP Requirement

MVP must include:

- Quote built from live Casper product interactions.
- UI source summary showing Casper RPC and CSPR.trade observations.
- Token-subject verdicts must show unavailable mandatory risk signals as not checked until a real token-state source supplies them.
- x402 payment requirement returned as HTTP 402 plus `PAYMENT-REQUIRED`.
- Agent-visible `payment_status` that proves the configured Casper x402 path is ready, or returns the exact missing configuration/facilitator support reason.
- Runtime x402 payment payload continuation for the existing quote through `PAYMENT-SIGNATURE`.
- Paid report release only after facilitator verification, settlement, and executed Casper RPC confirmation of the settlement transaction.
- Merkle proof verification over the released evidence record.
- Agent-visible `registry_status` that proves the configured AgentPay registry path is ready, or returns the exact missing package/script/key/client/RPC reason.
- Casper decision recording only through a configured real submitter, with the verified `datasetRoot` included in the submitter payload and the returned hash confirmed as executed against Casper JSON-RPC.
- Pre-payment PAY / REVIEW / BLOCK decisions that bind the original HTTP request, normalized x402 terms, provider decision, policy revision, and optional Casper authorization before any local signer is invoked.
- Exact post-payment settlement verification, response observation, one immutable purchase receipt, offline receipt verification, and honest off-chain/pending/anchored/failed anchor state.
- HTTP, MCP, shared-client, and CLI access to the same payment-audit behavior without sending buyer private keys to AgentPay.
- README and smoke script that do not imply completion where credentials or deployed contracts are still required.

Current proven evidence:

- Registry v2 install `2c53ec7d38757c7c252fa16acc4c099d1c53136c852f908821989ac42f0fa4e6` is confirmed executed at Testnet block 8,518,390.
- Registry v2 package `hash-050b717617b9c79535983d9e0cc2ba21dd379ce3450498601dba64324a2dcd1a` and contract `hash-b5e129dca5548f1bbe225db73042d08ab5b35cc976c3ac955bf2fe2a8cd92ee3` expose the expected receipt, recorder, and legacy decision entrypoints.
- Checked x402 settlement `2491e2cfc3fc2c299ebdfb25725a8c8a194918b813f8c7596eec13bce3cd7911` is confirmed executed through the self-hosted facilitator path.
- Receipt anchor `eb30265877e0bbb549efa6f09dbd8beb29efc31191724ce082fca45b6dddddfc` is confirmed executed at block 8,518,465. Dictionary readback binds receipt `0f253ef7ce564e046d23abf42c8cabdad7b1deeab2fa4fafd2e3619f93cdf231` to policy `2c1941b0c6880bbd2b7622a66a88f4c2e48d24edc0609770b689d44b1b054571`, the exact settlement, and recorder `account-hash-0a6c747e7b07f063349ef66909a82c84e29095eaf7774df62428d09e49aa8b80`.
- Qualification decision record `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b` remains confirmed executed.

Submission blockers remaining:

- Publish the GitHub repository and attach a public walkthrough video to DoraHacks.
- Do not claim hosted CSPR.cloud settlement as proven unless a separate hosted run is captured; it is currently only a drop-in configuration path.

Local readiness command:

```bash
npm run submission:check
```

Current result: every local and Casper evidence gate passes; the command remains non-zero only because the public GitHub and walkthrough URLs have not been supplied. Expected before DoraHacks submission: zero exit with every check passing.

Deferred:

- Multi-source policy engine.
- Wallet UX for creating payment payloads.
- Autonomous trading execution.
- Persistent quote storage.
- Production deployment and monitoring.
