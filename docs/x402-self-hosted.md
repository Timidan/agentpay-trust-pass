# Running the x402 paid flow on Casper Testnet

AgentPay's paid leg settles a real CEP-18 transfer through an x402 facilitator. You can run it two
ways; both produce a real, RPC-confirmed Casper Testnet settlement.

- **Self-hosted facilitator** (no CSPR.cloud account needed) — uses the official open-source
  [make-software/casper-x402](https://github.com/make-software/casper-x402) facilitator with your
  funded key as the fee-payer. This is what produced the submission's settlement evidence.
- **Hosted CSPR.cloud facilitator** — a drop-in swap: point `X402_FACILITATOR_URL` at
  `https://x402-facilitator.cspr.cloud` and set `CSPR_CLOUD_ACCESS_TOKEN`. No buyer/report changes.

## Components

| Component | Where | Role |
|---|---|---|
| Buyer signer | [scripts/x402-buyer.ts](../scripts/x402-buyer.ts) + `npm run x402:buy` | Signs the EIP-712 `TransferWithAuthorization` and posts `PAYMENT-SIGNATURE` |
| Report API | `apps/report-api` (`REPORT_API_PORT=4021 ./node_modules/.bin/tsx apps/report-api/src/server.ts`) | Quotes live evidence, forwards payment to the facilitator, confirms the settlement on Casper, releases the report |
| Facilitator | `make-software/casper-x402` `apps/facilitator` | `/verify` (off-chain signature check) + `/settle` (submits the on-chain CEP-18 transfer, pays gas) |
| CEP-18 x402 token | `Cep18X402.wasm` from casper-x402 `infra/local/deployer` | EIP-712 authorized-transfer CEP-18; deployed on Testnet |

## Self-hosted run

1. **Deploy the EIP-712 CEP-18 token** on Testnet (Odra install; the deploying account is minted the
   initial supply and acts as the buyer). The token's EIP-712 domain `name` is the `name` arg,
   `version` defaults to `1`, and `chain_name` is the `chain_id` arg — set `chain_id` to the CAIP-2
   network id (`casper:casper-test`). Lower the Wasm to MVP first (Casper rejects bulk-memory; the
   prebuilt token also carries `sign-ext`):

   ```bash
   wasm-opt Cep18X402.wasm -O2 --signext-lowering --strip-target-features \
     --mvp-features --enable-mutable-globals -o Cep18X402.mvp.wasm
   casper-client put-deploy --node-address $RPC --chain-name casper-test \
     --secret-key $CASPER_SECRET_KEY_PATH --payment-amount 800000000000 \
     --session-path Cep18X402.mvp.wasm \
     --session-arg "name:string='Cep18x402'" --session-arg "symbol:string='X402'" \
     --session-arg "decimals:u8='9'" --session-arg "initial_supply:u256='1000000000000000'" \
     --session-arg "chain_id:string='casper:casper-test'" \
     --session-arg "odra_cfg_is_upgradable:bool='true'" --session-arg "odra_cfg_is_upgrade:bool='false'" \
     --session-arg "odra_cfg_allow_key_override:bool='true'" \
     --session-arg "odra_cfg_package_hash_key_name:string='X402_package_hash'"
   ```

   Read the package hash from the deploying account's `X402_package_hash` named key.

2. **Run the facilitator** (fee-payer = your funded key) against Testnet:

   ```bash
   CASPER_NETWORKS=casper:casper-test \
   SECRET_KEY_ALGO_CASPER_CASPER_TEST=secp256k1 \
   RPCURL_CASPER_CASPER_TEST=https://node.testnet.casper.network/rpc \
   SECRET_KEY_PEM_CASPER_CASPER_TEST="$(cat $CASPER_SECRET_KEY_PATH)" \
   PORT=4022 ./facilitator   # go build ./apps/facilitator in the casper-x402 repo
   ```

3. **Run the report API** pointed at the facilitator and token:

   ```bash
   X402_NETWORK=casper:casper-test \
   X402_FACILITATOR_URL=http://127.0.0.1:4022 \
   X402_ASSET_PACKAGE_HASH=<X402_package_hash, 64 hex> \
   PAYEE_ADDRESS=00<64-hex recipient account hash> \
   X402_TOKEN_NAME=Cep18x402 X402_TOKEN_VERSION=1 X402_TOKEN_DECIMALS=9 X402_TOKEN_SYMBOL=X402 \
   AGENT_PAY_REPORT_AMOUNT=10000 CASPER_RPC_URL=https://node.testnet.casper.network/rpc \
   ./node_modules/.bin/tsx apps/report-api/src/server.ts
   ```

4. **Run the buyer** — quotes live evidence, signs, settles, and prints the confirmed settlement:

   ```bash
   REPORT_API_URL=http://127.0.0.1:4021 CASPER_SECRET_KEY_PATH=$CASPER_SECRET_KEY_PATH npm run x402:buy
   ```

## Hosted CSPR.cloud swap

Skip steps 1–2 and, in step 3, set `X402_FACILITATOR_URL=https://x402-facilitator.cspr.cloud`,
`CSPR_CLOUD_ACCESS_TOKEN=<token>`, and `X402_ASSET_PACKAGE_HASH`/`X402_TOKEN_NAME` to the
CSPR.cloud-recognised asset. The buyer and report API are unchanged — the EIP-712 digest and
signature are byte-identical (verified against the facilitator's published vector).

## EIP-712 domain notes (so signatures verify)

- Scheme: `TransferWithAuthorization(from address,to address,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)` with Casper domain types `name,version,chain_name,contract_package_hash`.
- `from`/`to` are 33-byte Casper addresses (`00`/`01` tag + account hash), keccak256-encoded as the EIP-712 `address` type.
- Domain `chain_name` is the **full CAIP-2 id** (`casper:casper-test`) — confirmed against the facilitator's `/verify`.
- Signature is Casper-tagged: secp256k1 `0x02 || ECDSA(sha256(digest))` (low-S, r‖s); ed25519 `0x01 || ed25519(digest)`.
