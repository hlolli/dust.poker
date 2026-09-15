---
status: proposed
---

# Nothing about the cards is disclosed by default

After a deal, deck keys are never published, shares for unused positions are never posted, folded hands are never revealed, and the deck order stays unknown. Disputes are only missed deadlines and are settled from public ledger state, so no dispute ever requires a key or a card to be shown. Showdown settles by proof: each player proves the rank of their hand in a circuit and the contract pays without anyone seeing a card. Showing is a player's choice, available after any deal, won, lost or folded. The only automatic reveal is live poker's all-in rule: when everyone still in is all-in and no betting remains, hands are tabled before the run-out. Details: `docs/protocol/dealing.md`, "Disclosure".

## Consequences

- Hand histories and replays need their own disclosure actions; they never fall out of the protocol for free. "Show your bluff" is the show action after a fold-win.
- Reveal-by-default, as people know poker, was rejected: the design exists so that no card is seen without its owner's choice.
- Noted 2026-09-15, with showdown in the contract: the proven rank is public and carries the hand's composition (category and the ranks that decide ties), though not the suits or which cards were held. With the board public, that often pins the hole cards' ranks. Hiding the rank too would need a comparison protocol between players; not pursued for now.
