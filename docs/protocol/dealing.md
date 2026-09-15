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
- **Batching shares.** One transaction per player per stage, all positions of that stage inside. Adopted; it is how phases 2 and 3 are written above.
- **Attaching shares to bets.** Releasing next-street shares with every action would make the card readable as soon as the last active player acts, which in a reopened betting round is before betting closes: a leak. Releasing only with non-reopening actions (check, call, fold, all-in) avoids the leak and saves a block in most streets, at the cost of one extra transaction from the last aggressor when a raise closes the round. Candidate; decide after measuring how much a block costs relative to proving.
- **Off-chain proof verification.** Midnight verifies proofs when a transaction is included; there is no cheaper on-chain path, and moving verification to the players would make the contract stop being the referee. Proof aggregation or recursion is not available in Compact. Rejected.
- **Cheaper shuffles.** Every card needs its own re-encryption scalar or the permutation leaks through linkable ciphertexts, so 52 re-encryptions (104 scalar multiplications) is the floor per shuffle. The permutation check is planned as a 52 x 52 boolean matrix with row and column sums of one; it needs no dynamic indexing, which Compact lacks, and its cost is small next to the multiplications. Alternatives to be tried only if the benchmark forces it.

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

Proofs are generated by a prover the player controls. For the development prototype that is Midnight's proof server in Docker on the player's machine. The client talks to it through one interface (`Prover`, wrapping midnight-js's `ProofProvider`) so that other genuinely local or user-controlled provers can replace it. No prover operated by us ever receives a player's witnesses. The onboarding requirement (Docker or otherwise) is fixed only after the wallet, prover and headset browser have been tried together.

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

## Open decisions

- Whether attach-to-action release is worth its extra transaction, after measurement.
- Bond size (accepted at the maximum buy-in for the prototype) and forfeit distribution, after the economics review.
- Whether the all-in tabling rule stays, see Disclosure.
