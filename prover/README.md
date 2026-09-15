# prover

Midnight's wasm prover (`midnight-zkir-wasm`) built with threads, the way `midnight-ledger/wasm-proving-demos/zkir-mt` does it. Two lines of Rust; the substance is the build:

```
scripts/build-prover-mt.sh     # needs nix; output in .compact/prover-mt/
```

Threads in wasm need `SharedArrayBuffer`, so pages that use this must be served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
