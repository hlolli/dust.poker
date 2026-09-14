---
status: proposed
---

# Rules are written in Compact; circuits verify claims rather than compute

The poker rules are written once, in Compact, and the compiled circuits are the referee both on Midnight and inside the browser for the Practice table (compiled Compact is plain JS that executes circuits against an in-memory ledger; only proving needs a proof server). To keep circuits small in a language with no division, no unbounded loops and fully unrolled arithmetic, the referee verifies instead of computing: a seat claims its best five-card hand as a witness and the circuit checks the claim is valid and compares it with the others; a client proposes the payout and the circuit checks conservation and eligibility. Hand ranking, payout proposals, bot decisions and the shuffle protocol therefore live in TypeScript, where they are needed anyway.

**Status is proposed** until a spike shows the compiled wasm runtime executes circuits in a browser, including a headset browser. If it does not, the fallback is a TypeScript referee written as the readable spec, ported to Compact when the chain phase begins, with this ADR marked superseded.

## Considered options

- TypeScript referee first, Compact later: no toolchain risk up front, but two implementations of the rules forever.
- Computing rankings inside the circuit: simplest to reason about, but thousands of constraints per showdown with no data on proving time.
