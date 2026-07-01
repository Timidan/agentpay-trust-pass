# AgentPay — Trust Signal for the Casper DeFi Frontier

The evidence check for the new Casper DeFi frontier — paste a Casper token package hash, and the Trust Signal buys live on-chain evidence over x402, scores the observed facts deterministically against a published policy, and stamps a shareable **CLEAR / CAUTION / DANGER** verdict with proof of what was checked, permanently recorded on Casper.

**Honest framing:** this is our Casper Agentic Buildathon project, evolved from the AgentPay x402 rail. The stamp means *proof of what the agent checked and that it decided* — not proof the answer is true. Flags are automated evidence, not financial advice. AgentPay does not ship canned token-risk rows; unavailable signals are surfaced as not checked.

## Trust Signal — consumer flow

1. Open the **ASK** page in the web UI.
2. Paste a Casper token package hash.
3. With x402 and registry credentials configured, watch the agent spend CSPR via x402, fetch live evidence, and score deterministically.
4. See the verdict: aspect badge, flags list, rationale prose, and on-chain proof links.
5. Tap **SHARE** to share the verdict (the subject hash + decision + explorer link).

## Roadmap

- **Now (Testnet):** Trust Signal uses live Casper evidence and no fixture provider. The repo has one proven self-hosted x402 settlement plus one confirmed registry decision on Casper Testnet; the hosted CSPR.cloud facilitator path is optional and not yet proven end-to-end.
- **Mainnet — coverage expansion:** CSPR.trade and Ghostminter token coverage; real market data signals wired into the scoring policy.
- **Finals window — GhostGuard:** Parametric insurance product where on-chain verdicts gate automatic claim payouts. A DANGER verdict within a coverage window triggers a GhostGuard payout without a human adjuster.

## Product Flow

1. Quote a report built from runtime Casper RPC and CSPR.trade MCP observations.
2. Check whether the configured x402 facilitator, asset, payee, and network are ready for settlement.
3. Buy the report through the x402-gated report API with a real payment payload.
4. Verify the returned Merkle proof against the dataset root.
5. Check whether the configured AgentPay registry package, submitter, and Casper RPC boundary are ready for decision recording.
6. Record the decision through the configured AgentPay registry submitter.
7. Show live source hashes, payment readiness, registry readiness, settlement evidence, proof status, and Casper transaction confirmation.

The UI is intentionally two-stage: first quote live evidence and return the x402 requirement, then continue the same quote with a runtime payment payload. The repository does not include a payment stand-in.

The maintained list of what AgentPay can currently do live is [docs/live-capabilities.md](docs/live-capabilities.md). Treat that file as the product boundary when adding claims to the UI, README, or submission copy.

## Current Evidence State

The current captured Testnet evidence is a real self-hosted x402 run, not hosted CSPR.cloud:

- Registry package hash: `hash-73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97`.
- Registry install hash: `c399eca336b515aaeda96c7b567f7dd61cb16d63c0cea7416923b5346db10b86`.
- x402 settlement hash: `36cec4739b3576b86c694cc710f54b7d00eb7403779e593b927ead053e939236`.
- Decision record hash: `da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b`.

The settlement used the self-hosted open-source `casper-x402` facilitator. Hosted CSPR.cloud remains a drop-in configuration path, but it should be described as unproven until a separate hosted run is captured.

## Local Development

```bash
npm install
npm test
npm run build
npm run smoke
```

## Casper Testnet Registry

Build the AgentPayRegistry Wasm used for Testnet deployment:

```bash
npm run build:contract
```

This build is not a plain `cargo build`. Casper's Wasm engine rejects the `bulk-memory`
operations that recent Rust toolchains emit by default (`Wasm preprocessing error: ... Bulk
memory operations are not supported`), so [`build-contract.sh`](contracts/agent-pay-registry/scripts/build-contract.sh)
recompiles `core`/`alloc` with those features disabled (`-Z build-std`) and then lowers the
residual `sign-ext`/nontrapping-fptoint operators back to MVP with `wasm-opt`. It therefore
requires **binaryen** (`wasm-opt`) on `PATH` (e.g. `npm i -g binaryen`). The final step re-emits
under a strict `mvp + mutable-globals` feature set and fails loudly if any non-MVP opcode survives.

Install and verify `casper-client` if it is not already available:

```bash
cargo install casper-client
casper-client get-state-root-hash --node-address https://node.testnet.casper.network/rpc
```

Create a local Testnet key if you do not already have a funded Casper key. The generated directory is ignored by git:

```bash
casper-client keygen .agentpay-testnet-key
casper-client account-address --public-key .agentpay-testnet-key/public_key_hex
casper-client query-balance \
  --node-address https://node.testnet.casper.network/rpc \
  --purse-identifier .agentpay-testnet-key/public_key_hex
```

Fund the printed account on Casper Testnet before deploying. The readiness gate requires enough balance for the registry install and decision-record payments: `AGENT_PAY_INSTALL_PAYMENT_AMOUNT + AGENT_PAY_RECORD_PAYMENT_AMOUNT`. After funding, use `.agentpay-testnet-key/secret_key.pem` as `CASPER_SECRET_KEY_PATH` and `.agentpay-testnet-key/public_key_hex` as `CASPER_PUBLIC_KEY_PATH` so the readiness gate can verify the account balance without reading signing material.

Check the current funding status and faucet link:

```bash
npm run submission:funding
```

The official Casper faucet is at https://testnet.cspr.live/tools/faucet and requires the Casper Wallet/CSPR.live browser flow. Re-run `npm run submission:funding` after requesting tokens.

If you already have a funded Casper Testnet wallet, place the exported key files in the ignored local key directory:

```bash
mkdir -p .agentpay-testnet-key
# put the exported funded private key PEM here:
# .agentpay-testnet-key/funded_secret_key.pem
# if your wallet exports a matching public key hex file, put it here:
# .agentpay-testnet-key/funded_public_key_hex
chmod 600 .agentpay-testnet-key/funded_secret_key.pem
```

The local `.env.submission.local` should point at the PEM with `CASPER_SECRET_KEY_PATH`. If your wallet does not export a `public_key_hex` file, set `CASPER_ACCOUNT_IDENTIFIER` to the funded wallet address/account hash instead. Do not paste private key material into env files, chat, docs, or source.

Deploy the registry with the funded Casper Testnet key and capture the observed install/package evidence:

```bash
npm run submission:deploy-registry
```

The command runs the registry deploy script, waits for the install hash to execute on Casper, queries the deploying account's named keys for `agentpay_registry_package`, and writes `AGENT_PAY_REGISTRY_INSTALL_HASH` plus `AGENT_PAY_REGISTRY_PACKAGE_HASH` into the ignored `.env.submission.local`.

## Submission Check

Run the local readiness audit:

```bash
npm run submission:check
```

The command exits non-zero until all qualification evidence is present. It reads `.env`, `.env.local`, and `.env.submission.local` if present, while exported shell variables take precedence. It checks the README, registry Wasm, runtime/source integrity, `casper-client`, signing key path, deployed registry package hash, confirmed registry install hash, confirmed x402 settlement hash, confirmed decision-record hash, reachable GitHub URL, and reachable public demo video URL. The current local evidence covers the registry install, self-hosted x402 settlement, and decision hashes; public GitHub/video URLs still need to be supplied for a final green gate.

Use an explicit local evidence file when you do not want to export values in your shell:

```bash
npm run submission:check -- --env-file .env.submission.local
```

After the real Testnet and x402 run, capture non-secret evidence into the ignored local file:

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

Add `CSPR_CLOUD_ACCESS_TOKEN` or `X402_FACILITATOR_AUTH_TOKEN` to `.env.submission.local` manually only when using the hosted CSPR.cloud facilitator; a self-hosted local facilitator does not require hosted auth. Do not pass long-lived secrets through shell history.

For a human-readable evidence report:

```bash
npm run submission:report
```

For a replayable proof dossier focused on the demo edges:

```bash
npm run submission:proof -- --env-file .env.submission.local
```

Use these environment variables for the external proof:

- `AGENT_PAY_REGISTRY_INSTALL_HASH`: Casper deploy or transaction hash from installing AgentPayRegistry.
- `AGENT_PAY_SETTLEMENT_TX_HASH`: Casper transaction hash returned by the x402 settlement.
- `AGENT_PAY_DECISION_TX_HASH`: Casper deploy or transaction hash from `record_decision_with_root`.
- `AGENT_PAY_QUOTE_ID`: optional quote id printed in the proof dossier when captured.
- `AGENT_PAY_DATASET_ROOT`: optional Merkle dataset root printed in the proof dossier when captured.
- `SUBMISSION_GITHUB_URL`: public GitHub repository URL.
- `SUBMISSION_DEMO_VIDEO_URL`: public walkthrough video URL.

The DoraHacks submission draft lives at [docs/dorahacks-submission.md](docs/dorahacks-submission.md). It should not be treated as final until `npm run submission:check` passes with real external evidence.

## Scope

The app does not ship committed business evidence rows or invented payment/transaction receipts. Local runs can quote live Casper sources and verify that the x402 gate is enforced. A full paid run requires `X402_ASSET_PACKAGE_HASH`, `PAYEE_ADDRESS`, `CASPER_RPC_URL`, a supported `X402_FACILITATOR_URL`, a valid `PAYMENT-SIGNATURE` payload, `AGENT_PAY_REGISTRY_PACKAGE_HASH`, `CASPER_CLIENT_COMMAND`, and `CASPER_SECRET_KEY_PATH`. Hosted CSPR.cloud additionally requires `CSPR_CLOUD_ACCESS_TOKEN` or `X402_FACILITATOR_AUTH_TOKEN`; the captured evidence used the self-hosted facilitator.

`X402_ASSET_PACKAGE_HASH` must be the CEP-18 asset package hash as raw `64 hex chars`. `PAYEE_ADDRESS` must be the Casper account hash that receives payment in `00<64 hex chars>` form.

`AGENT_PAY_REGISTRY_PACKAGE_HASH` must be a deployed Casper package hash in `hash-<64 hex chars>` or raw `64 hex chars` form.

AgentPay uses x402 V2 headers: the report API returns `PAYMENT-REQUIRED`, the buyer agent retries with `PAYMENT-SIGNATURE`, and a settled response includes `PAYMENT-RESPONSE`.

### x402 buyer

The buyer agent that produces the `PAYMENT-SIGNATURE` lives in [scripts/x402-buyer.ts](scripts/x402-buyer.ts) (signing) and [scripts/x402-buy.ts](scripts/x402-buy.ts) (CLI). It builds the EIP-712 `TransferWithAuthorization` digest with the official `@casper-ecosystem/casper-eip-712` package and signs it with the exact Casper x402 scheme the facilitator verifies (secp256k1: `0x02 ‖ ECDSA(sha256(digest))`; ed25519: `0x01 ‖ ed25519(digest)`). Run it against a configured report API:

```bash
REPORT_API_URL=http://127.0.0.1:4021 \
CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem \
npm run x402:buy
```

It quotes live evidence, signs the payment authorization, retries `buy_report` with `PAYMENT-SIGNATURE`, and prints the released report plus the confirmed settlement transaction — or the exact missing x402 configuration if the report API is not fully configured. The proven run used self-hosted `casper-x402`; hosted CSPR.cloud is a configuration swap, not a captured end-to-end claim.

AgentPay only releases a paid report after facilitator verification, settlement returns a Casper transaction/deploy hash in raw `64 hex chars` form, and `CASPER_RPC_URL` confirms executed `info_get_transaction` results for that hash.

The MCP bridge exposes `quote_report`, `payment_status`, `registry_status`, `buy_report`, `verify_report`, `record_decision`, and `assess_subject`. With the x402 buyer key, payment config, registry package, submitter key, and Casper RPC configured, `assess_subject` runs the full quote → settle → verify → score → narrate → record pipeline in one call and returns a typed `Verdict`. `payment_status` and `registry_status` are intentionally separate from mutation tools so agents can detect missing Casper configuration before attempting settlement or registry writes.

See [docs/real-product-constraints.md](docs/real-product-constraints.md) for the current hackathon comparison and product bar.

---

*Automated evidence flags, not financial advice. Running on Casper Testnet. The verdict stamp means proof of what the agent checked and that it decided — not proof the answer is true.*
