#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: record-decision-testnet.sh <dataset-id> <dataset-root> <report-hash> <payment-receipt-hash> <decision>" >&2
  exit 2
fi

CASPER_CLIENT_COMMAND="${CASPER_CLIENT_COMMAND:-casper-client}"
CASPER_NODE_ADDRESS="${CASPER_NODE_ADDRESS:-https://node.testnet.casper.network/rpc}"
CASPER_CHAIN_NAME="${CASPER_CHAIN_NAME:-casper-test}"
AGENT_PAY_RECORD_PAYMENT_AMOUNT="${AGENT_PAY_RECORD_PAYMENT_AMOUNT:-5000000000}"

if [ "$CASPER_CHAIN_NAME" != "casper-test" ]; then
  echo "AgentPay writes are restricted to Casper Testnet (casper-test)" >&2
  exit 2
fi

if ! command -v "$CASPER_CLIENT_COMMAND" >/dev/null 2>&1; then
  echo "CASPER_CLIENT_COMMAND must point to casper-client" >&2
  exit 2
fi

if [ -z "${CASPER_SECRET_KEY_PATH:-}" ]; then
  echo "CASPER_SECRET_KEY_PATH is required to submit record_decision_with_root to Casper Testnet" >&2
  exit 2
fi

if [ ! -r "$CASPER_SECRET_KEY_PATH" ]; then
  echo "CASPER_SECRET_KEY_PATH must point to a readable owner or recorder key" >&2
  exit 2
fi

if [ -z "${AGENT_PAY_REGISTRY_PACKAGE_HASH:-}" ]; then
  echo "AGENT_PAY_REGISTRY_PACKAGE_HASH must be a deployed Casper Testnet package hash" >&2
  exit 2
fi

if [[ ! "$AGENT_PAY_REGISTRY_PACKAGE_HASH" =~ ^(hash-)?[0-9a-fA-F]{64}$ ]]; then
  echo "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars" >&2
  exit 2
fi

DATASET_ID="$1"
DATASET_ROOT="$2"
REPORT_HASH="$3"
PAYMENT_RECEIPT_HASH="$4"
DECISION="$5"

if [[ ! "$DATASET_ID" =~ ^[A-Za-z0-9_.:-]{1,128}$ ]]; then
  echo "dataset id must use 1-128 letters, numbers, dots, colons, underscores, or hyphens" >&2
  exit 2
fi

if [[ ! "$DATASET_ROOT" =~ ^[0-9a-f]{64}$ ]]; then
  echo "dataset root must be 64 lowercase hex chars" >&2
  exit 2
fi

if [[ ! "$REPORT_HASH" =~ ^[0-9a-f]{64}$ ]]; then
  echo "report hash must be 64 lowercase hex chars" >&2
  exit 2
fi

if [[ ! "$PAYMENT_RECEIPT_HASH" =~ ^[0-9a-f]{64}$ ]]; then
  echo "payment receipt hash must be 64 lowercase hex chars" >&2
  exit 2
fi

case "$DECISION" in
  approved | rejected | needs_review) ;;
  *)
    echo "decision must be approved, rejected, or needs_review" >&2
    exit 2
    ;;
esac

exec "$CASPER_CLIENT_COMMAND" put-deploy \
  --node-address "$CASPER_NODE_ADDRESS" \
  --chain-name "$CASPER_CHAIN_NAME" \
  --secret-key "$CASPER_SECRET_KEY_PATH" \
  --payment-amount "$AGENT_PAY_RECORD_PAYMENT_AMOUNT" \
  --session-package-hash "$AGENT_PAY_REGISTRY_PACKAGE_HASH" \
  --session-entry-point "record_decision_with_root" \
  --session-arg "dataset_id:string='$DATASET_ID'" \
  --session-arg "dataset_root:string='$DATASET_ROOT'" \
  --session-arg "report_hash:string='$REPORT_HASH'" \
  --session-arg "payment_receipt_hash:string='$PAYMENT_RECEIPT_HASH'" \
  --session-arg "decision:string='$DECISION'"
