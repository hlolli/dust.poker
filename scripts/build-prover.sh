#!/usr/bin/env bash
# Builds Midnight's wasm prover (midnight-zkir-wasm) and the matching native key generator
# from source with nix, and assembles the wasm into an npm-style package.
#
#   scripts/build-prover.sh [out dir]      default: .compact/prover
#
# Output layout:
#   <out>/zkir-wasm/   the @midnightntwrk/zkir-v2 package (browser entry, Bun/Node entry, typings)
#   <out>/bin/zkir     native `zkir compile-many <zkir dir> <keys dir>`; needs MIDNIGHT_PP
#   <out>/params/      public KZG parameters bls_midnight_2p0..2p17 (MIDNIGHT_PP points here)
#
# Why by hand: the flake's own `#zkir-wasm` output fails in its packaging step (it copies
# zkir-v2.d.ts, the file is zkir.d.ts), so we take its compiled .wasm and run the same
# wasm-bindgen step ourselves. Prover keys must come from this `zkir`, not from the zkir-v3
# binary bundled with compactc: same version string, different key file format.
set -euo pipefail

# Pinned: the revision the keys and the wasm were validated against; a newer one may change the IR or key format.
FLAKE="github:midnightntwrk/midnight-zkir/7dff84a685cd8baed2e69a2b66ae63573fe5a575"
OUT="${1:-$(cd "$(dirname "$0")/.." && pwd)/.compact/prover}"
mkdir -p "$OUT"
cd "$OUT"

echo "== native zkir and public parameters"
nix build "$FLAKE#zkir" -o zkir-native
nix build "$FLAKE#public-params" -o params-store
mkdir -p bin params
cp -f zkir-native/bin/zkir bin/zkir
cp -f params-store/bls_midnight_2p* params/
chmod u+w params/*

echo "== raw wasm (the flake's packaging step fails; we stop at the compiled .wasm)"
# The derivation that compiles the crate is a dependency of #zkir-wasm; build it directly.
RAW=$(nix build "$FLAKE#zkir-wasm.raw-wasm" -o zkir-raw --print-out-paths 2>/dev/null || true)
if [ -z "$RAW" ]; then
  # Fallback: let #zkir-wasm run until it fails, then pick the compiled crate from its inputs.
  nix build "$FLAKE#zkir-wasm" -o zkir-pkg 2>/dev/null || true
  RAW=$(nix-store -qR "$(nix path-info --derivation "$FLAKE#zkir-wasm")" 2>/dev/null | grep -- "-zkir-wasm-3" | grep -v "\.drv$" | head -1 || true)
fi
if [ -z "$RAW" ] || [ ! -f "$RAW/midnight_zkir_wasm.wasm" ]; then
  RAW=$(ls -d /nix/store/*-zkir-wasm-3.*/ 2>/dev/null | head -1)
fi
[ -f "$RAW/midnight_zkir_wasm.wasm" ] || { echo "could not locate the compiled midnight_zkir_wasm.wasm" >&2; exit 1; }
echo "raw wasm: $RAW"

echo "== wasm-bindgen 0.2.108 (must match the crate's wasm-bindgen dependency)"
mkdir -p zkir-wasm
nix shell nixpkgs#wasm-bindgen-cli_0_2_108 -c wasm-bindgen "$RAW/midnight_zkir_wasm.wasm" \
  --out-dir zkir-wasm --target bundler --omit-default-module-path --weak-refs --reference-types --no-typescript
nix shell nixpkgs#binaryen -c wasm-opt zkir-wasm/midnight_zkir_wasm_bg.wasm -Os --enable-reference-types -o zkir-wasm/midnight_zkir_wasm_bg.wasm

cat > zkir-wasm/midnight_zkir_wasm_fs.js <<'EOF'
export * from "./midnight_zkir_wasm_bg.js";
import * as exports from "./midnight_zkir_wasm_bg.js";
import { __wbg_set_wasm } from "./midnight_zkir_wasm_bg.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const bytes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'midnight_zkir_wasm_bg.wasm'));
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { './midnight_zkir_wasm_bg.js': exports });
__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
EOF
curl -sSf "https://raw.githubusercontent.com/midnightntwrk/midnight-zkir/main/zkir-wasm/zkir.d.ts" -o zkir-wasm/zkir-v2.d.ts
cat > zkir-wasm/package.json <<'EOF'
{
  "name": "@midnightntwrk/zkir-v2",
  "version": "3.0.0",
  "type": "module",
  "types": "./zkir-v2.d.ts",
  "exports": { "types": "./zkir-v2.d.ts", "browser": "./midnight_zkir_wasm.js", "node": "./midnight_zkir_wasm_fs.js" }
}
EOF
ls -la zkir-wasm bin
echo "done: $OUT"
