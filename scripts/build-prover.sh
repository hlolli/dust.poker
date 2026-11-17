#!/usr/bin/env bash
# Compatibility entry point: Bun installs the released wasm prover; only public parameters
# need preparing. An optional output directory keeps the former <out>/params layout.
set -euo pipefail
exec bun "$(dirname "$0")/prover.ts" "$@"
