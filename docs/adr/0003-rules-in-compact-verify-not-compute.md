---
status: accepted
---

# Rules are written in Compact; circuits verify claims rather than compute

The poker rules are written once, in Compact, and the compiled circuits are the referee both on Midnight and inside the browser for the Practice table (compiled Compact is plain JS that executes circuits against an in-memory ledger; only proving needs a proof server). To keep circuits small in a language with no division, no unbounded loops and fully unrolled arithmetic, the referee verifies instead of computing: a seat claims its best five-card hand as a witness and the circuit checks the claim is valid and compares it with the others; a client proposes the payout and the circuit checks conservation and eligibility. Hand ranking, payout proposals, bot decisions and the shuffle protocol therefore live in TypeScript, where they are needed anyway.

Accepted on 2026-09-14 after the spike in `spike/compact-browser/`: midnight-js's precompiled counter contract, `@midnight-ntwrk/compact-runtime` 0.14.0 and its 1.4 MB wasm run in a desktop Chromium page bundled by Bun, with no node process and no proof server. Wasm ready in about 80 ms, four circuit calls in 7 ms, `assert` failures surface as thrown `CompactError`. Not yet tested in a headset browser.

## Consequences

- Bun's bundler treats `.wasm` imports as file URLs, so `@midnight-ntwrk/onchain-runtime-v2`'s browser entry needs a resolver plugin that swaps in a shim which fetches and instantiates the wasm (see the spike). The shim must expose a `ready` promise that callers await before importing the runtime; Bun's dev-server HMR does not block importers on top-level await.
- The compiler (`compactc`) is not needed to run contracts, only to build them. It gets installed when the first dust.poker contract is written.

## Considered options

- TypeScript referee first, Compact later: no toolchain risk up front, but two implementations of the rules forever.
- Computing rankings inside the circuit: simplest to reason about, but thousands of constraints per showdown with no data on proving time.
