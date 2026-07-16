#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: record-receipt-testnet.sh <receipt-hash> <policy-hash> <settlement-transaction-hash> <outcome>" >&2
  exit 2
fi

CASPER_CLIENT_COMMAND="${CASPER_CLIENT_COMMAND:-casper-client}"
CASPER_NODE_ADDRESS="${CASPER_NODE_ADDRESS:-${CASPER_RPC_URL:-https://node.testnet.casper.network/rpc}}"
CASPER_CHAIN_NAME="${CASPER_CHAIN_NAME:-casper-test}"
AGENT_PAY_RECEIPT_RECORD_PAYMENT_AMOUNT="${AGENT_PAY_RECEIPT_RECORD_PAYMENT_AMOUNT:-5000000000}"

if ! command -v "$CASPER_CLIENT_COMMAND" >/dev/null 2>&1; then
  echo "CASPER_CLIENT_COMMAND must point to casper-client" >&2
  exit 2
fi

if [ -z "${AGENT_PAY_REGISTRY_RECORDER_KEY_PATH:-}" ] || [ ! -r "$AGENT_PAY_REGISTRY_RECORDER_KEY_PATH" ]; then
  echo "AGENT_PAY_REGISTRY_RECORDER_KEY_PATH must point to the dedicated readable recorder key" >&2
  exit 2
fi

if [[ ! "${AGENT_PAY_REGISTRY_PACKAGE_HASH:-}" =~ ^(hash-)?[0-9a-f]{64}$ ]]; then
  echo "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 lowercase hex chars> or 64 lowercase hex chars" >&2
  exit 2
fi

RECEIPT_HASH="$1"
POLICY_HASH="$2"
SETTLEMENT_TX_HASH="$3"
OUTCOME="$4"

for value in "$RECEIPT_HASH" "$POLICY_HASH" "$SETTLEMENT_TX_HASH"; do
  if [[ ! "$value" =~ ^[0-9a-f]{64}$ ]]; then
    echo "receipt, policy, and settlement hashes must be 64 lowercase hex chars" >&2
    exit 2
  fi
done

if [ "$OUTCOME" != "settlement_matched" ]; then
  echo "outcome must be settlement_matched" >&2
  exit 2
fi

exec "$CASPER_CLIENT_COMMAND" put-deploy \
  --node-address "$CASPER_NODE_ADDRESS" \
  --chain-name "$CASPER_CHAIN_NAME" \
  --secret-key "$AGENT_PAY_REGISTRY_RECORDER_KEY_PATH" \
  --payment-amount "$AGENT_PAY_RECEIPT_RECORD_PAYMENT_AMOUNT" \
  --session-package-hash "$AGENT_PAY_REGISTRY_PACKAGE_HASH" \
  --session-entry-point "record_purchase_receipt" \
  --session-arg "receipt_hash:string='$RECEIPT_HASH'" \
  --session-arg "policy_hash:string='$POLICY_HASH'" \
  --session-arg "settlement_tx_hash:string='$SETTLEMENT_TX_HASH'" \
  --session-arg "outcome:string='$OUTCOME'"
