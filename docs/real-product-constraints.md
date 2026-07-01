# AgentPay Real Product Constraints

Date: 2026-06-29

## Product Rule

AgentPay must show evidence produced by runtime interaction with Casper ecosystem products. The repository must not carry committed business evidence rows that make the app look complete without live integrations.

Current runtime source set:

- Casper Node RPC: network status and latest finalized block from `CASPER_RPC_URL`.
- Token-subject evidence: package-hash validation plus live latest-block context from `CASPER_RPC_URL`; mint authority, supply renouncement, holder distribution, LP holders, and liquidity depth remain not checked until a real token-state source is wired in.
- CSPR.trade MCP: DEX pair surface from `CSPR_TRADE_MCP_URL`.
- x402 facilitator: payment verification and settlement through `X402_FACILITATOR_URL`, using `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers. The proven Testnet run used the self-hosted open-source `casper-x402` facilitator at `http://127.0.0.1:4022`; the hosted CSPR.cloud facilitator remains an optional drop-in path that has not been exercised end-to-end in this repo.
- AgentPayRegistry submitter: Casper decision recording through `casper-client put-deploy` against the deployed `record_decision_with_root` entry point.
- AgentPayRegistry readiness: non-mutating checks for `AGENT_PAY_REGISTRY_PACKAGE_HASH` shape, record script availability, `CASPER_SECRET_KEY_PATH`, `casper-client`, and `CASPER_RPC_URL` reachability.

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
- Product thesis: agents should pay for Casper product evidence, verify the evidence cryptographically, then record a trust decision on Casper.

Complexity bar:

- Stronger than a thin UI over one API because it spans live source ingestion, payment gating, proof verification, MCP tools, and an on-chain decision boundary.
- Strongest when presented as a paid evidence rail, not generic payment plumbing: the current evidence includes one real self-hosted x402 settlement and one confirmed AgentPayRegistry decision on Casper Testnet.

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
- Current Testnet evidence in the local submission env and DoraHacks draft includes registry package `hash-73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97`, registry install `c399eca336b515aaeda96c7b567f7dd61cb16d63c0cea7416923b5346db10b86`, self-hosted x402 settlement `36cec4739b3576b86c694cc710f54b7d00eb7403779e593b927ead053e939236`, and decision record `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`.
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
- README and smoke script that do not imply completion where credentials or deployed contracts are still required.

Current proven evidence:

- AgentPayRegistry is installed on Casper Testnet at package hash `hash-73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97`.
- Registry install hash `c399eca336b515aaeda96c7b567f7dd61cb16d63c0cea7416923b5346db10b86` is confirmed executed.
- x402 settlement hash `36cec4739b3576b86c694cc710f54b7d00eb7403779e593b927ead053e939236` is confirmed executed from the self-hosted facilitator path.
- Decision record hash `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b` is confirmed executed and carries the paid-flow receipt hash.

Submission blockers remaining:

- Publish the GitHub repository and attach a public walkthrough video to DoraHacks.
- Re-run `npm run submission:check` from an environment with network access so the local gate can reconfirm the captured Testnet hashes.
- Do not claim hosted CSPR.cloud settlement as proven unless a separate hosted run is captured; it is currently only a drop-in configuration path.

Local readiness command:

```bash
npm run submission:check
```

Expected before external credentials/deployment: non-zero exit with explicit missing evidence. Expected before DoraHacks submission: zero exit with every check passing.

Deferred:

- Multi-source policy engine.
- Wallet UX for creating payment payloads.
- Autonomous trading execution.
- Persistent quote storage.
- Production deployment and monitoring.
