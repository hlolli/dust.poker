# Spike: compiled Compact in the browser

Question: does a compiled Compact contract execute in a browser page bundled by Bun, with no node and no proof server? Decides ADR 0003.

Result (2026-09-14): pass. See the ADR for numbers.

```
bun install
bun run dev        # http://localhost:3001, prints SPIKE PASS
bun run build.ts   # production bundle in dist/
```

- `contract/` is midnight-js's precompiled `counter` contract, copied verbatim (Apache-2.0, Midnight Foundation).
- `wasm-shim.js` + `wasm-plugin.ts` make `@midnight-ntwrk/onchain-runtime-v2` load under Bun; `bunfig.toml` wires the plugin into the dev server, `build.ts` into the build.
- `main.ts` awaits the wasm, then imports the runtime and runs increment/decrement and an assert failure.
