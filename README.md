# dust.poker

No-Limit Texas Hold'em in a 3D casino room, desktop and WebXR, refereed by a smart contract on Midnight. No game server.

- Glossary: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr/](docs/adr/)

## Develop

```
bun install
bun dev        # dev server with hot reload
bun test
bun run check  # typecheck + test + build
```

## A Midnight network on your machine

The contract compiles for ledger 9, which no public Midnight network runs yet, so the Live table is played on the "undeployed" network: a node and a proof server in Docker, and an indexer built from source (the wallet needs a newer one than Docker Hub carries). Everything for it sits in `local/`:

```
docker compose -f local/compose.yml up -d
local/build-indexer.sh      # once; Rust 1.95 through rustup
local/indexer.sh            # keep running
```

Lace: Settings > Midnight > network Undeployed, with the node at http://localhost:9944, the indexer at http://localhost:8088/api/v4/graphql and the proof server at http://localhost:6300. Then give it Night from the chain's genesis wallet:

```
cd local && bun install && cd ..
bun local/fund.ts <the mn_addr_undeployed... address Lace shows under Receive>
```

The menu's Live side then connects to Lace on Undeployed, opens a table or takes a seat at one by its address. `local/compose.yml` explains the rest, including how to start the chain over.
