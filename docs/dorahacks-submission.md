# AgentPay DoraHacks Submission Draft

This draft is for the Casper Agentic Buildathon Qualification Round. Do not paste it as final until `npm run submission:check` exits with status 0 against real Casper Testnet, x402, GitHub, and walkthrough evidence.

Use [live-capabilities.md](live-capabilities.md) as the boundary for live claims while editing this draft.

> **Product is now AgentPay Trust Pass** (the consumer-facing evolution of the buildathon project): paste a Casper token or wallet, the agent buys live evidence over x402, verifies the paid evidence against the quoted dataset root, scores observed facts deterministically against a published policy, and returns a copyable **CLEAR / CAUTION / DANGER** receipt. The receipt is proof of *what the agent checked, paid for, verified, and recorded on Casper*, not a claim the answer is universally true — "automated evidence flags, not financial advice." The runtime does not ship canned token-risk fixtures; unavailable signals are surfaced as not checked.

## Project

Name: AgentPay

One-line summary: AgentPay Trust Pass lets a user or autonomous agent pay for Casper evidence, verify the proof root, and leave with a copyable on-chain receipt for the resulting trust decision.

Category fit:

- Casper Innovation Track
- Agentic AI
- DeFi payments
- x402 infrastructure
- Casper Testnet smart contract workflow

## Problem

Autonomous agents and consumers can call APIs and move funds, but most payment flows still ask them to trust an off-chain service response. AgentPay turns a paid API response into a consumer-readable Trust Pass: quote live Casper evidence, require x402 payment, release the report only after settlement, verify the returned proof, then record the decision on Casper.

## What It Does

- Quotes live evidence from configured Casper ecosystem sources.
- Returns an x402 payment requirement before the paid report is released.
- Accepts a runtime x402 payment payload for the same quote.
- Releases the paid report only after facilitator verification, settlement, and Casper RPC confirmation of the settlement hash. The captured paid run used the self-hosted open-source `casper-x402` facilitator.
- Verifies the released report against its Merkle dataset root.
- Records the verified decision through the AgentPayRegistry contract on Casper Testnet.
- Exposes the flow through the web UI and MCP tools so an agent can inspect readiness before paying or writing on-chain.
- Produces a copyable Trust Pass receipt with dataset root, x402 receipt hash, settlement transaction, Casper decision record, and policy hash.
- Supports consumer token checks and counterparty wallet checks from the first screen.

## Casper Usage

- Casper RPC is used for live network evidence and transaction confirmation.
- Casper x402 configuration is required for payment settlement. Current evidence proves the self-hosted facilitator path; hosted CSPR.cloud remains an optional drop-in swap that has not been exercised end-to-end.
- AgentPayRegistry is a Casper Wasm contract with `record_decision_with_root` and `get_dataset_root` entry points.
- The submission is only ready after a real AgentPayRegistry install hash, x402 settlement hash, and decision-record hash are confirmed as executed on Casper.

## Agentic AI Usage

AgentPay is designed as an agent-facing payment and proof rail. The MCP server exposes:

- `quote_report`
- `payment_status`
- `registry_status`
- `buy_report`
- `verify_report`
- `record_decision`

Agents can use the read-only status tools before attempting payment or registry mutation, which keeps missing configuration visible instead of hiding it behind fake success states.

## Demo Walkthrough

Show these steps only with real environment values configured:

1. Run `npm run submission:report` to show the evidence gate.
2. Run `npm run submission:funding` to show the funded Casper Testnet account.
3. Open the AgentPay web app.
4. Show the AgentPay Trust Pass landing: token check, wallet check, and receipt packet.
5. Quote live Casper evidence.
6. Show the x402 payment requirement.
7. Continue the same quote with a real x402 payment payload.
8. Show paid report release, source hashes, settlement hash, and proof verification.
9. Record the verified decision through AgentPayRegistry.
10. Open the result card and copy the Trust Pass receipt packet.
11. Run `npm run submission:check` and show every gate passing.

## Evidence Required Before Final Submission

Only fill a row from a real run. Do not invent values for the video or DoraHacks form.

Deploying Casper Testnet account: `account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785`
(network `casper-test`, Casper 2.0 / api_version 2.0.0).

| Evidence | Value / Source | Status |
|---|---|---|
| AgentPayRegistry package hash | `hash-73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97` | Installed on Testnet |
| Registry install hash | `c399eca336b515aaeda96c7b567f7dd61cb16d63c0cea7416923b5346db10b86` ([cspr.live](https://testnet.cspr.live/deploy/c399eca336b515aaeda96c7b567f7dd61cb16d63c0cea7416923b5346db10b86)) | Confirmed executed |
| CEP-18 x402 asset package hash | `a7888ddfbc31455396f3c57583547962a28bcb3b20e60d6be2dea3a8f2991d4d` | Installed on Testnet (EIP-712 authorized-transfer token) |
| x402 settlement hash | `18139485f3546d29d543ffb89c4472ac8f59cd989b8e32df51e9b5a27b3300e1` ([cspr.live](https://testnet.cspr.live/transaction/18139485f3546d29d543ffb89c4472ac8f59cd989b8e32df51e9b5a27b3300e1)) | Confirmed executed — real CEP-18 `transfer_with_authorization` settled via the x402 facilitator |
| Decision record hash | `dd53186c084d8da08b2a48388fbfc6363cda4794f35b75ccd4c5cc2d9b4ebcfd` ([cspr.live](https://testnet.cspr.live/deploy/dd53186c084d8da08b2a48388fbfc6363cda4794f35b75ccd4c5cc2d9b4ebcfd)) | Confirmed executed — paid-flow decision carrying the real settlement `payment_receipt_hash` |
| Public GitHub repository URL | `SUBMISSION_GITHUB_URL` | Pending — publish repo |
| Public demo video URL | `SUBMISSION_DEMO_VIDEO_URL` | Pending — record walkthrough |

The settlement + decision above came from one live paid UI run on quote
`trust-aaaaaaaaaaaaaaaa-8410848-64a999eb73bad243` (dataset root
`3d22813499fc421e219aec35d6ce38f4344cd688dd74062485da07a1febc989b`, report hash
`64a999eb73bad2437bc2b6fcc12734cc92f6ee9f9658442a31fbc28590fc7e16`): the buyer signed an EIP-712 `TransferWithAuthorization`, the report API forwarded it to the
x402 facilitator (`/verify` then `/settle`), the facilitator settled a real CEP-18 transfer on
Testnet (tx above), AgentPay confirmed it executed via `info_get_transaction`, released the report,
and the decision was recorded with that settlement's `payment_receipt_hash`
(`91616bd4bcf93edbd12bc5682851c7e042b1dafa8bfeccd8954391606b3f0aca`).

The settlement used the **self-hosted open-source casper-x402 facilitator** (fee-payer = the
deploying account). The hosted CSPR.cloud path is a drop-in swap: set
`X402_FACILITATOR_URL=https://x402-facilitator.cspr.cloud` and add `CSPR_CLOUD_ACCESS_TOKEN`.
See [x402-self-hosted.md](x402-self-hosted.md) for the reproducible run recipe. Do not describe
the hosted CSPR.cloud facilitator as proven until a separate hosted settlement hash is captured.

Earlier registry-only proof (pre-x402): decision `ff62b357…` recorded the live quote
`agent-pay-live-8173585-e3faea90fc87ae1d` root `eaad25b4…` (validation receipt, not a settlement).

Put local evidence values in `.env.submission.local` or export them in the shell. `.env.submission.local` is ignored by git and should contain only real values from the final Testnet/x402 run.

For a funded Casper Testnet wallet, keep the key material as local files and point `.env.submission.local` at them:

```bash
CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem
CASPER_PUBLIC_KEY_PATH=.agentpay-testnet-key/funded_public_key_hex
```

If the wallet only exports a private PEM plus an address/account hash, use:

```bash
CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem
CASPER_ACCOUNT_IDENTIFIER=account-hash-<64 hex chars>
```

After those files are in place, deploy and capture registry evidence from Casper:

```bash
npm run submission:deploy-registry
```

Use the helper to write validated non-secret evidence:

```bash
npm run submission:evidence -- \
  --casper-rpc-url <https-casper-rpc-url> \
  --casper-secret-key-path <local-secret-key-path> \
  --casper-public-key-path <local-public-key-path> \
  --registry-package-hash <agentpay-registry-package-hash> \
  --registry-install-hash <executed-install-hash> \
  --x402-asset-package-hash <cep18-asset-package-hash> \
  --payee-address <payee-account-hash> \
  --settlement-tx-hash <executed-x402-settlement-hash> \
  --decision-tx-hash <executed-decision-record-hash> \
  --github-url <public-github-repo-url> \
  --demo-video-url <public-demo-video-url>
```

Add `CSPR_CLOUD_ACCESS_TOKEN` or `X402_FACILITATOR_AUTH_TOKEN` by editing `.env.submission.local`; avoid passing long-lived tokens through shell history.

## Submission Gate

Run:

```bash
npm run submission:check
```

For the replayable demo proof bundle:

```bash
npm run submission:proof -- --env-file .env.submission.local
```

For a human-readable report:

```bash
npm run submission:report
```

The project is not qualification-ready unless every check passes.
