#!/usr/bin/env bash
set -euo pipefail

# Builds the AgentPayRegistry Wasm so the Casper 2.0 (Condor) execution engine accepts it.
#
# Why this is not a plain `cargo build`:
#   Recent Rust toolchains (>= 1.87 / mid-2025 nightlies) enable the `bulk-memory` and
#   `sign-ext` Wasm features by default for wasm32-unknown-unknown, and the precompiled
#   `core`/`alloc` carry them too. Casper's Wasm preprocessor rejects bulk-memory outright
#   ("Bulk memory operations are not supported"), so an unmodified build installs-then-reverts
#   while still consuming the full gas limit.
#
# The fix has two parts:
#   1. Recompile std (`-Z build-std`) with the non-MVP target features disabled so bulk-memory
#      is never emitted, anywhere.
#   2. Lower the residual `sign-ext` and nontrapping-float-to-int operators back to MVP with
#      wasm-opt, then re-emit under a strict `mvp + mutable-globals` feature set. The final
#      re-emit FAILS LOUDLY if any non-MVP opcode survives, so a bad artifact can never ship.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
MANIFEST="$REPO_ROOT/contracts/agent-pay-registry/Cargo.toml"
TOOLCHAIN="${AGENT_PAY_CONTRACT_TOOLCHAIN:-nightly-2025-06-23}"
TARGET_DIR="$REPO_ROOT/contracts/agent-pay-registry/target/wasm32-unknown-unknown/release"
RAW_WASM="$TARGET_DIR/agent_pay_registry_contract.wasm"
CARGO_COMMAND="${AGENT_PAY_CARGO_COMMAND:-cargo}"

if ! command -v wasm-opt >/dev/null 2>&1; then
  echo "wasm-opt (binaryen) is required to produce a Casper-compatible Wasm." >&2
  echo "Install binaryen (e.g. 'npm i -g binaryen' or your package manager) and re-run." >&2
  exit 2
fi

echo "[build-contract] compiling with build-std (bulk-memory disabled), toolchain $TOOLCHAIN"
RUSTFLAGS="-C target-feature=-bulk-memory,-sign-ext,-reference-types,-multivalue,-bulk-memory-opt" \
  "$CARGO_COMMAND" "+$TOOLCHAIN" build \
    -Z build-std=core,alloc \
    -Z build-std-features=compiler-builtins-mem \
    --manifest-path "$MANIFEST" \
    --features contract \
    --bin agent_pay_registry_contract \
    --release \
    --target wasm32-unknown-unknown

if [ ! -f "$RAW_WASM" ]; then
  echo "[build-contract] expected Wasm not found at $RAW_WASM" >&2
  exit 2
fi

TMP_LOWERED="$(mktemp --suffix=.wasm)"
trap 'rm -f "$TMP_LOWERED"' EXIT

echo "[build-contract] lowering sign-ext / nontrapping-fptoint to MVP and stripping metadata"
wasm-opt "$RAW_WASM" \
  -Oz \
  --strip-debug \
  --strip-producers \
  --llvm-nontrapping-fptoint-lowering \
  --signext-lowering \
  --strip-target-features \
  -o "$TMP_LOWERED"

echo "[build-contract] re-emitting under strict MVP + mutable-globals (fails if any non-MVP opcode remains)"
wasm-opt "$TMP_LOWERED" \
  --mvp-features \
  --enable-mutable-globals \
  -o "$RAW_WASM"

echo "[build-contract] OK -> $RAW_WASM ($(stat -c%s "$RAW_WASM") bytes, MVP + mutable-globals)"
