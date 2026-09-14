# The Practice table is a permanent mode, not scaffolding

The game is built graphics first, with the bots-only Practice table as the first thing that works. Rather than a throwaway stub, the Practice table runs the real referee locally in the player's browser, against five bots, with the same rules, blinds and clock as a Live table and nothing at stake. It stays in the app for good, so the two modes share one client seam (a `TableState` the scene subscribes to, an `act(Action)` call that may take seconds and may fail) and the scene never learns which referee is behind it.

## Consequences

- The scene never sees the deck or another seat's hole cards, even in Practice, so switching a table to Live changes no rendering code.
- Bots and the Practice referee ship in the client bundle; they are product, not test fixtures.
