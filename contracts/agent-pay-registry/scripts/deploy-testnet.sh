#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
CASPER_CLIENT_COMMAND="${CASPER_CLIENT_COMMAND:-casper-client}"
AGENT_PAY_CARGO_COMMAND="${AGENT_PAY_CARGO_COMMAND:-cargo}"
AGENT_PAY_CONTRACT_TOOLCHAIN="${AGENT_PAY_CONTRACT_TOOLCHAIN:-nightly-2025-06-23}"
CASPER_NODE_ADDRESS="${CASPER_NODE_ADDRESS:-https://node.testnet.casper.network/rpc}"
CASPER_CHAIN_NAME="${CASPER_CHAIN_NAME:-casper-test}"
AGENT_PAY_INSTALL_PAYMENT_AMOUNT="${AGENT_PAY_INSTALL_PAYMENT_AMOUNT:-25000000000}"
AGENT_PAY_REGISTRY_WASM="${AGENT_PAY_REGISTRY_WASM:-$REPO_ROOT/contracts/agent-pay-registry/target/wasm32-unknown-unknown/release/agent_pay_registry_contract.wasm}"

if ! command -v "$CASPER_CLIENT_COMMAND" >/dev/null 2>&1; then
  echo "CASPER_CLIENT_COMMAND must point to casper-client" >&2
  exit 2
fi

if [ -z "${CASPER_SECRET_KEY_PATH:-}" ]; then
  echo "CASPER_SECRET_KEY_PATH is required for Casper Testnet deploy" >&2
  exit 2
fi

if [ ! -f "$CASPER_SECRET_KEY_PATH" ]; then
  echo "CASPER_SECRET_KEY_PATH does not exist: $CASPER_SECRET_KEY_PATH" >&2
  exit 2
fi

if [ ! -f "$AGENT_PAY_REGISTRY_WASM" ]; then
  # Use the dedicated build that produces Casper-compatible (MVP + mutable-globals) Wasm.
  # A plain `cargo build` emits bulk-memory ops that Casper's preprocessor rejects.
  AGENT_PAY_CONTRACT_TOOLCHAIN="$AGENT_PAY_CONTRACT_TOOLCHAIN" \
  AGENT_PAY_CARGO_COMMAND="$AGENT_PAY_CARGO_COMMAND" \
    bash "$REPO_ROOT/contracts/agent-pay-registry/scripts/build-contract.sh"
fi

if [ ! -f "$AGENT_PAY_REGISTRY_WASM" ]; then
  echo "AgentPay registry wasm was not found after build: $AGENT_PAY_REGISTRY_WASM" >&2
  exit 2
fi

exec "$CASPER_CLIENT_COMMAND" put-deploy \
  --node-address "$CASPER_NODE_ADDRESS" \
  --chain-name "$CASPER_CHAIN_NAME" \
  --secret-key "$CASPER_SECRET_KEY_PATH" \
  --payment-amount "$AGENT_PAY_INSTALL_PAYMENT_AMOUNT" \
  --session-path "$AGENT_PAY_REGISTRY_WASM"
