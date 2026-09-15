# Dealing protocol

Status: provisional. Everything here is a working design to validate, not a spec to ship. Real assets stay off until the protocol, its performance, the disconnect economics and the legal position have been reviewed.

Vocabulary follows [CONTEXT.md](../../CONTEXT.md): a **deal** is one hand of poker from shuffle to payout; a **deck** is the 52 locked cards of one deal; a **share** is one player's contribution to unlocking one card.

## Goal

For every deal: one fresh deck that no party knows the order of; hole cards readable by their holder only; board cards readable by everyone at the table, and only once their street begins; nothing inferable from the shuffle; every step checked by the contract before the next is allowed.

## Protocol

Mental poker in the Barnett-Smart form (Barnett and Smart, "Mental Poker Revisited", 2003): the deck is a list of ElGamal ciphertexts under a key jointly held by all players; each player in turn shuffles and re-encrypts the whole deck and proves the shuffle honest; a card is decrypted by collecting one decryption share per player. The proofs are zero-knowledge circuits written in Compact and verified by the Midnight node when the transaction is included, so the contract itself is the referee of the shuffle. The decryption share proofs are the same kind of circuit.

Curve: Jubjub, through the Compact standard library (`ecAdd`, `ecNeg`, `ecMul`, `ecMulGenerator`, `hashToCurve`). Its arithmetic is native to the field the circuits work in, so these operations are the cheap kind; the benchmark confirms how cheap.

### Objects

- Card `k` (0..51) is the public point `M_k = hashToCurve("dust.poker:card:" || k)`. The list of 52 is a constant everyone can compute.
- A locked card is an ElGamal ciphertext `(A, B)` of points.
- Each player `i` makes a fresh **deck key** `x_i` for every deal and posts `P_i = x_i * G` with a proof of knowledge (the posting circuit takes `x_i` as witness). The deck's joint key is `P = sum P_i`.
- The unshuffled deck is `(0, M_k)` for k in 0..51: identity point first, plaintext second.

### Phases of one deal

Every phase is enforced by the contract: a transaction for phase `n` is rejected unless phase `n-1` is complete and verified. In particular no share is accepted for a deck whose shuffles are not all verified.

0. **Keys.** Every player seated for this deal posts `P_i`. One transaction each, all in the same block.
1. **Shuffle.** In seat order, each player takes the current deck `D`, picks a secret permutation `pi` and 52 secret scalars `r_j`, and posts `D'` with `D'_j = (A_{pi(j)} + r_j * G, B_{pi(j)} + r_j * P)`. The circuit proves `pi` is a permutation and each output is a re-encryption of the permuted input. Six sequential transactions for six players; this is the only inherently sequential phase.
2. **Hole cards.** Positions are fixed by seat order among the players dealt in: player at dealing order `d` holds positions `2d` and `2d+1`; the board is the next five positions. Each player posts, in one transaction, shares `s = x_i * A_p` for every position `p` that belongs to another player, with a proof that `s` uses the `x_i` behind their posted `P_i`. All players' transactions can share one block. Player `i` reads their own card as `B_p - sum_{j != i} s_j - x_i * A_p` and matches the result against the 52 public points.
3. **Flop, turn, river.** After betting on a street closes, every player still in the deal posts shares for that street's board positions (a **release**). The card is readable once every active player has released. Shares from folded and all-in players are already on chain (see Timeouts).
4. **Showdown.** Settled separately, see Disclosure.

Fold and all-in transactions carry the folding or all-in player's shares for every board position not yet released. After such a transaction the deal never waits on that player again.

### Position map and burns

No burn cards. Positions 0..(2n-1) are hole cards, 2n..2n+4 the board, the rest unused and never unlocked.

## Assumptions

**Privacy of hole cards.** Reading player `i`'s card needs `x_i * A_p`. Everyone else's shares are public, so the secrecy of `i`'s cards rests on `x_i` alone and on the decisional Diffie-Hellman assumption on Jubjub. Correction to an earlier statement of mine: it does not need "all five opponents to collude"; even a table of five colluders cannot read the sixth player's cards. They would need that player's key.

**Secrecy of the deck order.** A player who did not see another player's permutation knows nothing about where that shuffle moved cards. The deck order is hidden from anyone as long as at least one shuffler keeps their permutation secret, and every player is one such shuffler for their own deals. Colluders learn nothing about undealt cards for the same reason: unlocking one needs a share from every player.

**Randomness.** The deck order is a uniformly random permutation if at least one shuffler chose `pi` uniformly at random and fresh `r_j`. A dishonest shuffler cannot bias the result even adaptively, because the deck they shuffle is encrypted and tells them nothing about which permutation would help. No randomness is drawn from the chain; players' keys, permutations and scalars come from their own machine's CSPRNG. Deck keys are fresh per deal so that publishing one (see Pipelining) never touches another deal.

**Soundness.** A shuffle that is not a permutation, or a share made with the wrong key, is rejected when the transaction is verified. This rests on the soundness of Midnight's proof system and on the circuits being correct. Nothing here trusts a player to be honest for the game to be fair; dishonesty can only stall, never cheat.

**Zero knowledge.** Proofs reveal nothing beyond their statement. This rests on the proof system's zero-knowledge property and on proofs being generated by a prover the player controls (see Proving). A prover run by someone else sees the witnesses, which for a share proof is the deck key and for the reading step is the card.

**What is public regardless.** Who is seated, who acted when, the shares themselves (which are meaningless without the missing one), transaction timing, and the wallet that paid each fee. Seats are pseudonymous, not anonymous.

## Round trips and batching

Baseline for six players: 6 sequential shuffle transactions, then 1 block for hole-card shares, then 1 block per board street. Bets are their own transactions as before. Options examined:

- **Pipelining the shuffle.** The deck for deal `D+1` is shuffled while deal `D` is being bet. Phases 0 and 1 then cost nothing at the start of a deal. Rules: the players of `D+1` are those seated when its shuffle starts; a player who leaves before `D+1` publishes their deck key for `D+1` (they hold no cards in it, so this reveals nothing) and everyone strips that layer; a player who arrives after the shuffle started sits out `D+1`, as in a live game. Adopted, pending measurement.
- **Batching shares.** One transaction per player per stage, all positions of that stage inside. Adopted; it is how phases 2 and 3 are written above. The circuit `shares` takes ten positions (the other players' hole positions at a full table); a stage with fewer positions repeats one, since a duplicate share is the same point and reveals nothing new, so no share for an unused position is ever posted. A player's deal is then four share proofs (holes, flop, turn, river) instead of fifteen; a smaller circuit for the one-card streets is a possible refinement, not a need.
- **Attaching shares to bets.** Releasing next-street shares with every action would make the card readable as soon as the last active player acts, which in a reopened betting round is before betting closes: a leak. Releasing only with non-reopening actions (check, call, fold, all-in) avoids the leak and saves a block in most streets, at the cost of one extra transaction from the last aggressor when a raise closes the round. Candidate; decide after measuring how much a block costs relative to proving.
- **Off-chain proof verification.** Midnight verifies proofs when a transaction is included; there is no cheaper on-chain path, and moving verification to the players would make the contract stop being the referee. Proof aggregation or recursion is not available in Compact. Rejected.
- **Cheaper shuffles.** Every card needs its own re-encryption scalar or the permutation leaks through linkable ciphertexts, so 52 re-encryptions (104 scalar multiplications) is the floor per shuffle; measured alone they fill a k=15 circuit. The permutation check first shipped as a 52 x 52 selection network (Compact has no dynamic indexing), which turned out to be most of the k=17 circuit. It is now a grand product: the shuffler supplies the permuted deck as a witness, every card is compressed to one field element with a challenge `alpha`, and `prod (gamma + c(s_j))` must equal `prod (gamma + c(d_k))` for a challenge `gamma`. Both challenges are Poseidon hashes of the witness deck computed inside the circuit (Fiat-Shamir), so the prover fixes the deck before learning them; a deck that is not a rearrangement passes with probability about 208/|F|, near 2^-245, per attempt. Soundness argument: with independent `alpha` and `gamma` the two products are equal as bivariate polynomials only if the multisets of cards are equal (each factor is linear in `gamma`, hence irreducible, and F[X,Y] has unique factorisation), and Schwartz-Zippel bounds the chance of agreeing at a random point. `alpha` is a second hash of `gamma` rather than `gamma^2`, so that the argument does not depend on the two being algebraically related. The argument alone costs k=13; with the re-encryptions the shuffle is k=16.

The target after pipelining is roughly one block of dealing latency per street plus the time each player needs to prove a share, with betting itself unchanged.

## Timeouts and aborts

Two clocks, never confused:

- **Betting clock**: 30 seconds plus a 30-second time bank per deal, expiry is check-else-fold. Unchanged from the design session.
- **Protocol clock**: deadlines for posting keys, shuffles and shares. Derived from the benchmark (measured proving time times a safety factor plus block time), not chosen in advance.

Both are enforced by the contract on block time. Any wallet may submit the transaction that declares a deadline missed; the contract checks the deadline itself, so authorization comes from the ledger state, and submission and fee payment are whoever bothers. A keeper may exist; nothing requires one, and none of ours is required.

### Aborts

A missed protocol step means the deal cannot continue: without a player's shares, nobody can read the cards their layer protects. The deal **aborts**: every player's bets return to them, and the player who missed the step forfeits.

The forfeit has to be large enough that aborting is never a way out of a losing wager, including through an accomplice. Analysis of the deliberate cases:

1. **The loser aborts.** A player facing a big loss withholds their river shares. Forfeit must exceed what they were about to lose. With buy-ins capped at 100 BB, the most any player can lose in a deal is their stack, at most 100 BB.
2. **A folded accomplice aborts.** A folded friend of the loser withholds shares. Closed by construction: folding carries the shares for every unreleased board position, so a folded player has nothing left to withhold.
3. **A short all-in accomplice aborts.** The friend goes all-in for a small stack early, the loser and a third player build a big pot, the friend stalls the board. Closed the same way: an all-in transaction carries all remaining board shares.
4. **An active accomplice disconnects.** The friend stays in with chips and simply never acts on the street after the big money went in, so the betting clock folds them without their shares. Their cost is their contribution so far plus their bond. Their contribution can be small if the big betting happened on the street they refused to act on. The bond has to carry this case alone.

Rule: **bond equals the maximum buy-in (100 BB)**, locked at seat time on top of the stack and returned on leaving. An accomplice's abort then costs at least what it saves the loser, before the accomplice's own contribution, so the pair never comes out ahead. Forfeits (bond plus the offender's contribution) go to the players still in the deal at the abort, split equally. This doubles the capital a seat locks; acceptable for the prototype and revisited with the economics review.

A player who loses their deck key (lost browser state) cannot post shares and is treated like case 4. Private state export exists in midnight-js; the client will nag about backups.

**Threshold decryption (any five of six shares suffice) was considered and not adopted.** It would remove aborts, but it changes the privacy statement: with a five-of-six key, any five colluders could read the sixth player's hole cards, where today no coalition short of the holder can. Not to be introduced without reviewing that trade-off explicitly.

## Disclosure

Nothing is exposed by default. After a deal: deck keys are never published, shares for unused positions are never posted, folded hands are never revealed, and the deck order stays unknown forever.

**Showdown** settles by proof. Each player still in proves in a circuit, with their deck key as witness, the rank of their best hand from their locked cards and the board, without revealing the cards; the contract compares ranks and pays (ADR 0003: claims verified, not computed). Nobody sees a losing hand, or the winning one, unless its owner chooses to.

**Show** is a player's choice: posting shares for their own two positions makes their hole cards readable to the table, any time from the end of the deal, whether they won, lost or folded. "Show your bluff" is this action after a fold-win.

The one automatic reveal is the one live poker mandates: when every player still in is all-in and no betting remains, hands are tabled before the run-out, as at a real table. (Assumed from the design session's "except where the game rules require it"; remove if no automatic reveal is wanted.)

The alternative considered was reveal-by-default, as people know poker; it was rejected because the whole design is built so that no card is ever seen without its owner's choice.

**Disputes** in this design are only missed deadlines, because every shuffle and share is proven when posted. Handling them uses public ledger state only; no step of abort or forfeit ever requires a key or a card to be revealed.

## Proving

Proofs are generated by a prover the player controls. The prototype prover is Midnight's own prover compiled to wasm (`midnight-zkir-wasm`, built from source by `scripts/build-prover.sh`) running inside the player's browser: no separate process, nothing to install, and the witnesses never leave the page. Its `provingProvider` is the same interface the ledger's `Transaction.prove` takes, so the client talks to proving through that one interface and other user-controlled provers (a native one for desktop players, the proof server in Docker, whatever a wallet may offer) can replace it. No prover operated by us ever receives a player's witnesses. The onboarding requirement is fixed only after the wallet, prover and headset browser have been tried together.

## Practice table

The Practice table runs the same referee circuits and the same dealing protocol, executed locally without proofs. Each simulated player has its own private state (deck keys, permutations) managed separately from the human's, so the human's client never holds a bot's secrets in the same store. Proof bypasses live only in the Practice path and are not part of the deployable Live path. End-to-end tests that generate and verify real proofs stay in the suite.

## Stakes

Valueless test assets only. One unshielded asset per table, fixed while any funds are escrowed. The contract escrows stacks and bonds; `leave()` pays out only what is not committed to an unresolved deal, and takes effect at the end of the current deal for a seated player. Capabilities verified against the standard library (`receiveUnshielded`, `sendUnshielded`, `unshieldedBalance*`); shielded NIGHT is not assumed to exist as a drop-in.

## Benchmark plan

Measure the complete deal, not one circuit:

1. Full circuit set: key post, shuffle, hole-card shares, board release, fold-with-shares, all-in-with-shares, deadline transactions.
2. Local execution of a six-player deal in Bun (no proofs): correctness and wall time.
3. Proving through a local proof server for each circuit: time, proof size, memory.
4. Simulated chain timeline at 6-second blocks: with and without pipelining, with and without attach-to-action release.
5. Derive protocol deadlines from 3 and 4.

Results go into this document; deadlines into the contract constants.

### Results so far (2026-09-15, compactc 0.34.0, Apple Silicon laptop)

Circuits: `post_key`, `shuffle`, `share` in `contracts/deal.compact` (v0: cryptographic core, no table bookkeeping yet); `share` later became the batched `shares`, see the last entries.

- Local execution in Bun, six players (`contracts/deal.test.ts`): keys 35 ms, six shuffles 794 ms (about 130 ms each), 90 shares 218 ms. All 17 dealt cards distinct; a wrong key decodes to no card; non-permutations and mismatched shares are rejected.
- Proving-key generation (`compactc` without `--skip-zk`): ZKIR v2: 43.9 s wall for all three circuits, 3.0 GB peak memory, prover keys `shuffle` 85 MB, `share` 0.7 MB, `post_key` 0.35 MB. ZKIR v3 (`--feature-zkir-v3`, the format the wasm prover takes): 28.6 s, 1.6 GB peak, prover keys `shuffle` 135 MB, `share` 2.1 MB, `post_key` 0.5 MB; verifier keys 1.6 KB each. Prover key size tracks circuit size, so the shuffle is roughly 60 to 120 times the share circuit. The shuffle key is a file every player's prover loads; it ships with the static site and caches.
- Circuit sizes (rows = 2^k): `post_key` k=9, `share` k=11, `shuffle` k=17 (131,072 rows). The KZG parameter file for k=17 is 25 MB; Midnight's bucket (`bls_midnight_2p<k>`) has files to at least k=21, doubling per k.
- Proving time, wasm prover under Bun (single-threaded, Apple Silicon laptop), keys from the flake-built `zkir` (25.5 s, 1.5 GB to generate): `post_key` 0.9 s, `share` 3.0 s, `shuffle` 114 s warm and 134 s cold (key and parameter loading included). Proofs are 4,229 bytes each. Peak RSS 1.9 GB. Consequence: six sequential shuffles are about 12 minutes of proving per deal, more than a deal lasts, so pipelining alone does not hide it. Candidates, to be measured next: multi-threaded wasm (Midnight's `wasm-proving-demos/zkir-mt` shows the build flags; rayon over 8 cores would put a shuffle in the 15 to 30 s range), a smaller shuffle circuit (the 52 x 52 selection network is the bulk of k=17; a product-style permutation argument with an in-circuit Fiat-Shamir challenge could drop a level or two of k), and batching shares into one circuit per stage (15 separate share proofs are 45 s per player per deal).
- Proving time, same wasm prover in a Chromium page (`spike/prove-browser`, main thread, no workers): `post_key` 0.9 s, `share` 2.9 s, `shuffle` 142 s cold. Loading the 129 MB shuffle key from the local server took 0.2 s. The page stayed responsive enough to finish; no out-of-memory. Not yet run in a headset browser, where a single-threaded shuffle proof would be several times slower again.
- Threaded prover (`prover/`, `scripts/build-prover-mt.sh`: the upstream crate plus `wasm-bindgen-rayon`, std rebuilt with atomics, shared imported memory): builds and the pool of 8 comes up in 28 ms, but proving got slower, not faster: `post_key` 2.9 s, `share` 8.7 s, `shuffle` 142.7 s then 242.9 s. Per-thread CPU shows one busy thread; the pool's workers idle while the caller pays the coordination cost. The environment is not the cause: eight plain workers burn CPU in parallel in the same page. Resolved by measurement: rayon itself works in the build (`rayon_probe`, a `par_iter` workload, runs 7.6x faster with an 8-thread pool and reports 8 threads), and sampling the renderer every 5 s through a whole shuffle proof shows one thread at 100% for all but a 15-20 s window in which 8 threads run at 350-490%. About a tenth of the proof is parallel work (commitments, FFTs, MSMs); the rest is the single-threaded phase of interpreting the circuit's instruction stream and filling the table. Threads therefore cap out near a 10-15% gain on this circuit; with 4 threads the shuffle measured 95 s against 142 s single-threaded in the same session, within the noise of a loaded machine. The lever that remains for the shuffle is the size of the circuit itself (fewer instructions, lower k), or a native prover where the same interpretation runs an order of magnitude faster. Two environment notes for anyone re-measuring: the embedded Browser pane used here refuses nested workers loaded from http (Chrome does not), so the served rayon helper was patched to bootstrap sub-workers from `blob:` URLs; and the machine had five runaway `csound` processes pinning cores during every measurement in this section.
- Product-argument shuffle (same day, machine and load): `shuffle` is k=16 (65,536 rows) with 2,199 IR instructions, against k=17 and 27,366; prover key 67 MB against 135 MB; key generation for the three circuits 31 s and 3.3 GB peak. Wasm proving under Bun: 82 s cold, 77 s warm, from 134 and 114 s; proof still 4,229 bytes; RSS 1.0 GB. Exact rows from `zkir mock-compile`: `shuffle` 35,652, `share` 1,813, `post_key` 438; on their own, the 104 multiplications with their public inputs 30,573 (about 290 rows per multiplication, so k=15 is out of reach for a whole deck by any permutation argument), the permutation argument 5,627, of which the chained Poseidon over the deck 3,831 and the products 2,322. Two prover facts: `transientHash` over a value containing points compiles, but the prover cannot synthesise it ("cannot convert JubjubPoint to Native": its Poseidon takes native field elements only), so the circuit hashes coordinates through `jubjubPointX` and `jubjubPointY`; and proving time fell less than the row count (0.7x time for 0.5x rows), so a per-proof cost that does not scale with rows is significant at this size. Six sequential shuffles are now about 8 minutes in wasm, still longer than a deal; see the native calibration below.
- Native prover calibration (same day; `prover/native`, the same crates and keys as the wasm build, run as a process; machine: 6 performance and 12 efficiency cores, 5 of them still pinned by unrelated processes). Same preimages, and the library verifies every proof it makes before returning, so each time includes one verification: `post_key` 0.08 s, `share` 0.24 s, `shuffle` 4.9 s cold and 4.4 s warm with 18 rayon threads, 5.6 s with 4 threads, 9.6 s cold and 7.2 s warm with 1 thread; proofs 4,229 bytes; RSS 182 MB against 1.0 GB. So native code alone is about 11x faster than the wasm prover on one thread, and threads add 1.6x on top; the wasm build's interpretation phase is what wasm pays for. Consequence: a desktop player with a native prover shuffles in about 5 s, so a table of six such players prepares a deck in well under a minute including block time, and pipelining hides it entirely. A browser-only player (a headset) still pays 77 s or more per shuffle, and since shuffles are sequential the deck is ready when the slowest prover at the table is done. Position for the design: the wasm prover stays as the zero-install default and the headset path; desktop players get a native prover behind the same `ProvingProvider` interface (this binary grown into a local helper, the proof server in Docker, or a wallet's own); protocol deadlines are set per player from the prover they declare, not one global constant. Not yet measured: proving on a headset browser, and on a laptop without the extra load.
- Batched shares (same day): `shares` proves ten shares in one circuit of k=13, 6,231 rows (one share was k=11, 1,813 rows, so ten of them 18,130 rows in ten proofs); prover key 8.4 MB. Proving: wasm 10.9 s cold and 9.9 s warm against 30 s for ten single proofs; native 0.74 s cold and 0.66 s warm against 2.4 s. Per player per deal: four proofs, about 40 s in wasm or 2.7 s natively, and four transactions instead of fifteen. Local execution of the six-player deal: 12 batches in 98 ms against 90 single shares in 219 ms. The single-share circuit is gone; `shares` covers every stage by repeating a position when a stage has fewer than ten.
- Proving is done with Midnight's own wasm prover (`midnight-zkir-wasm`, built from `github.com/midnightntwrk/midnight-zkir` with nix) rather than the Docker proof server, so that proving can run in the player's browser with no separate process. Two packaging facts learned on the way: the flake's `zkir-wasm` output fails in its own packaging step (it copies `zkir-v2.d.ts`, the file is `zkir.d.ts`), so the wasm-bindgen step is done by hand from the compiled `.wasm`; and prover keys must be generated by the `zkir` built from the same source as the wasm, not by the `zkir-v3` binary bundled with compactc, whose key files this build does not read even though both report version 3.0.0-rc.2. The IR is passed as JSON through the package's `jsonIrToBinary`.

## Open decisions

- Whether attach-to-action release is worth its extra transaction, after measurement.
- Bond size (accepted at the maximum buy-in for the prototype) and forfeit distribution, after the economics review.
- Whether the all-in tabling rule stays, see Disclosure.
