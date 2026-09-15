---
status: proposed
---

# Two clocks, shares travel with folds and all-ins, and the bond equals the maximum buy-in

Betting has its own clock (30 s plus a 30 s time bank per deal, check-else-fold). Protocol steps (keys, shuffles, shares) have a separate clock whose deadlines are derived from measured proving and block times, not chosen up front. A missed protocol step aborts the deal: bets return, the offender forfeits. Because a fixed small penalty would let a losing player, or an accomplice, escape a large wager by stalling, three rules close the gaps: a fold or all-in transaction must carry the player's shares for every unreleased board card, so folded and all-in players can never stall; the bond locked at seat time equals the maximum buy-in (100 BB), so an active accomplice who disconnects always pays at least what the loser saves; forfeits go to the players still in the deal. Threshold decryption (any five of six shares) would remove aborts but would let five colluders read the sixth player's cards, and is not adopted without an explicit review of that trade-off. Analysis: `docs/protocol/dealing.md`, "Timeouts and aborts".

## Consequences

- A seat locks twice the maximum buy-in in capital. Acceptable for the test prototype; to be revisited in the economics review.
- Recovery transactions are permissionless: the ledger authorizes, anyone submits and pays.
