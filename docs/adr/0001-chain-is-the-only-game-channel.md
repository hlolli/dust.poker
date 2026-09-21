# Game state moves only through the chain

dust.poker is a multiplayer game with no game server. The Midnight contract is the referee: it holds the pot, enforces the rules, seats players from the queue, and its ledger state is the only channel through which one player's actions reach another. Clients read it through the Midnight indexer's GraphQL subscriptions and render what they see; latency is block time, and we accept that rather than run a relay that would have to be trusted. Presence (heads, hands, voice) is the one thing the chain cannot carry; it will go over Cloudflare Realtime (SFU) after V1, gated by a small credential function, and is never binding on the game.

Everything a player talks to is built from this public repository by CI, never from a developer machine: the static site deploys from `main`, the contract is compiled and deployed by a workflow that commits the resulting address and compiler version back into the repo, and any later credential function ships the same way. A player who does not trust the operator can rebuild and compare.

## Considered options

- A conventional game server that mirrors chain state and pushes updates over WebSockets: faster, but it becomes a party players must trust, which is what the ZK chain is supposed to remove.
- Peer-to-peer gossip for optimistic action echo: deferred; only worth adding if measured latency hurts.

## Consequences so far

- 2026-09-21: `src/live/referee.ts` is the client this decision describes. It reads the referee's state through the chain (the wallet's indexer), sends only its own seat's steps as transactions, and learns of every other seat's from the next snapshot. Two such clients play a deal to its end on a chain in memory (`src/live/referee.test.ts`). Latency is a poll for now; the indexer's subscription is the next step.
