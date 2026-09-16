#!/usr/bin/env bash
# Builds prover/native (Midnight's prover as a native binary) inside midnight-zkir's nix dev
# shell, so the toolchain and crate revisions match the wasm prover and the key generator.
#
#   scripts/build-prover-native.sh [out dir]      default: .compact/prover-native
#
# Output: <out dir>/prove, see prover/native/src/main.rs for its arguments.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/.compact/prover-native}"
# Pinned: the revision the keys and the wasm were validated against; a newer one may change the IR or key format.
FLAKE="github:midnightntwrk/midnight-zkir/7dff84a685cd8baed2e69a2b66ae63573fe5a575"
CRATE="$ROOT/prover/native"
TARGET_DIR="$ROOT/.compact/prover-native-target"

mkdir -p "$OUT" "$TARGET_DIR"

echo "== cargo build (native, release) in the midnight-zkir dev shell"
nix develop "$FLAKE" -c bash -c "
  set -euo pipefail
  cd '$CRATE'
  export CARGO_TARGET_DIR='$TARGET_DIR'
  cargo build --release --bin prove
"
cp "$TARGET_DIR/release/prove" "$OUT/prove"
ls -la "$OUT"
echo "done: $OUT/prove"
