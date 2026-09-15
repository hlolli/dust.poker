# Spike: proving in the browser

Proves the dealing circuits with Midnight's wasm prover inside a browser page bundled by Bun. Companion to `scripts/bench-prove.ts`, which does the same under Bun.

```
ZKIR_WASM=<nix result dir> KEYS=<keys dir> ZKIR=<zkir dir> bun build.ts   # bundles into dist/ and copies keys, IR and params
cd dist && python3 -m http.server 3003                                   # any static server that serves .wasm as application/wasm
```

Open http://localhost:3003 and read the timings on the page. Proving runs on the main thread here; the real client will use a Worker.
