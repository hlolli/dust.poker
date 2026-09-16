#!/usr/bin/env bash
# Builds prover/ (Midnight's wasm prover plus a rayon thread pool) for wasm32 with
# threads, inside midnight-zkir's nix dev shell so the toolchain matches upstream:
# stable Rust with rust-src (std is rebuilt with atomics), wasm32 target, wasm-bindgen 0.2.108.
#
#   scripts/build-prover-mt.sh [out dir]      default: .compact/prover-mt
#
# Output: a wasm-bindgen `--target web` package: index.js with a default `init()` export,
# `initThreadPool(n)`, the zkir API, `_bg.wasm`, and snippets/ with the rayon worker helper.
# Pages using it need Cross-Origin-Opener-Policy: same-origin and
# Cross-Origin-Embedder-Policy: require-corp, or SharedArrayBuffer is unavailable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/.compact/prover-mt}"
# Pinned: the revision the keys and the wasm were validated against; a newer one may change the IR or key format.
FLAKE="github:midnightntwrk/midnight-zkir/7dff84a685cd8baed2e69a2b66ae63573fe5a575"
CRATE="$ROOT/prover"
TARGET_DIR="$ROOT/.compact/prover-mt-target"

mkdir -p "$OUT" "$TARGET_DIR"

echo "== cargo build (wasm32, atomics, std rebuilt) in the midnight-zkir dev shell"
# RUSTC_BOOTSTRAP lets a stable toolchain accept -Z build-std, as upstream's demo does.
nix develop "$FLAKE" -c bash -c "
  set -euo pipefail
  cd '$CRATE'
  export RUSTC_BOOTSTRAP=1
  # rustc 1.98 does not link shared memory on its own when +atomics is set (the feature is
  # unstable, so its linker branch does not fire); pass what that branch would have: shared,
  # imported memory (wasm-bindgen's threads transform needs the import), and the TLS and
  # heap symbols the transform injects thread ids with. 4 GB is wasm32's ceiling.
  # Link args go to the final crate only (cargo rustc -- ...); in RUSTFLAGS they would hit
  # every intermediate link too, and e.g. wasm-streams has no __tls_* to export.
  LINK='-C link-arg=--shared-memory -C link-arg=--max-memory=4294967296 -C link-arg=--import-memory'
  LINK=\"\$LINK -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base -C link-arg=--export=__heap_base\"
  export RUSTFLAGS=\"-C target-feature=+atomics,+bulk-memory,+mutable-globals --cfg getrandom_backend=\\\"wasm_js\\\"\"
  export CARGO_TARGET_DIR='$TARGET_DIR'
  cargo rustc --release --lib --crate-type cdylib --target wasm32-unknown-unknown -Z build-std=panic_abort,std -- \$LINK
  echo '== wasm-bindgen'
  wasm-bindgen '$TARGET_DIR/wasm32-unknown-unknown/release/dust_poker_prover.wasm' \
    --out-dir '$OUT' --out-name index --target web --weak-refs --reference-types
"

echo "== wasm-opt"
nix shell nixpkgs#binaryen -c wasm-opt "$OUT/index_bg.wasm" -O --enable-threads --enable-bulk-memory --enable-reference-types --enable-mutable-globals -o "$OUT/index_bg.wasm"

ls -la "$OUT" "$OUT/snippets" 2>/dev/null || ls -la "$OUT"
echo "done: $OUT"
