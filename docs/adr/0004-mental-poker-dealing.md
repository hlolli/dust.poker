---
status: proposed
---

# Cards are dealt by fully verified mental poker

The deck is a list of ElGamal ciphertexts on Jubjub under a key held jointly by the seated players; each player shuffles and re-encrypts it once per deal with a zero-knowledge proof of an honest shuffle, and cards are unlocked by collecting one proven decryption share per player (Barnett-Smart mental poker, proofs as Compact circuits). One fresh deck and fresh deck keys per deal. The contract admits no share for a deck whose shuffles are not all verified. Hole cards are readable only by their holder; board cards only after every active player has released them for that street. There is no fallback to committed-but-unproven shuffles; if proving is too slow, the answer is fewer round trips (pipelining the next deck during the current deal, batching shares), not less verification. Timeout and recovery transactions are permissionless and validated by the contract alone; no machine of ours is required. Details and assumptions: `docs/protocol/dealing.md`.

## Considered options

- A single rotating dealer who commits to the shuffle and reveals afterwards: simple, but the dealer sees every card during the deal.
- Optimistic shuffles proven only on dispute, backed by bonds: faster honest path, but the game's fairness would rest on players noticing and on dispute code, and the decision to take it would have been a timing threshold rather than a design choice.
