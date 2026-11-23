# dust.poker

No-Limit Texas Hold'em in a 3D casino room, desktop and WebXR, refereed by a smart contract on Midnight. No game server.

- Glossary: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr/](docs/adr/)

## Develop

```
bun install
bun dev        # dev server with hot reload
bun test
bun run check  # compile contracts + typecheck + test + build
```

## Live on Ledger 9

### Play with colleagues

1. Each player needs their own browser profile and Ledger 9 compatible Lace wallet on the same network. Start with [Preview](https://dust.poker/?network=preview), which has a public indexer. In Lace's Midnight settings, select a prover that runs on your own device, either the in-process prover if available or a running local Ledger 9 proof server.
2. If Lace shows the retired `blockfrost.lw.iog.io` proxy, set the node and indexer for your network as shown below. Wait for Lace to sync. For Preprod, substitute your own Midnight Preprod project token in both URLs. Lace derives the WebSocket indexer URL from the HTTP URL. [Midnight network endpoints](https://docs.midnight.network/relnotes/network)
3. Request tNIGHT at your unshielded address, select **Generate tDUST** in Lace, and wait for tDUST to accrue. Each seat puts 200 STAR into play and posts a 200 STAR bond. Hosting and playing require tDUST for multiple transaction fees. [Wallet funding guide and faucets](https://docs.midnight.network/guides/acquire-tokens)
4. At dust.poker, create a player profile, select the wallet's network and choose **Connect Lace**. One player chooses **Open a new table** and approves each deployment transaction. Once the table opens, choose **Copy table link** and send it to the group. Everyone, including the host, chooses **Take a seat**. The first hand starts when two players are seated.
5. Keep the tab open and approve the wallet prompts during the hand. To withdraw your remaining stack and bond, choose **Cash out**, finish any hand you are in, and approve the withdrawal. Wait for **Seat closed** and check the payout in Lace. **Back to menu** leaves your funds at the table.

| Lace setting | Preview | Preprod |
| --- | --- | --- |
| Node | `https://rpc.preview.midnight.network` | `https://rpc.midnight-preprod.blockfrost.io?project_id=YOUR_TOKEN` |
| Indexer | `https://indexer.preview.midnight.network/api/v4/graphql` | `https://midnight-preprod.blockfrost.io/api/v0?project_id=YOUR_TOKEN` |

### Build the Live contract

The contract uses Compact 0.36.1, Compact runtime 0.21, on-chain runtime v4, Ledger v9, and
the released ZKIR v3 prover. Versions are pinned in `package.json` and `bun.lock`.
See Midnight's [Ledger 9 upgrade guide](https://docs.midnight.network/relnotes/ledger-9).

Generate the proving artifacts before serving Live:

```
bun run compact:build --zk
bun dev
# or: bun run build
```

Key generation uses Compact's bundled `zkir-v3`; the wasm prover is installed by Bun.
Public KZG parameters are downloaded on demand. No Nix build is needed for this path.
The dev server and static build serve the keys and binary ZKIR under `/deal`.
After changing compiler or circuit versions, regenerate keys and deploy a new table:
existing tables have immutable verifier keys and cannot use the new artifacts.

`bun run prove:deal` proves all 19 circuits. The `prove` workflow runs that gate on every
push, and the `live` workflow checks an entire deal against a Ledger 9 node, including fees
and withdrawal. `bun run live:check` runs the same integration check locally.

## A Midnight network on your machine

For development, `local/compose.yml` runs the released Ledger 9 stack on the "undeployed"
network: node 2.1.101, indexer 4.4.101, and proof server 9.0.2. Their ports bind to localhost.

```
docker compose -f local/compose.yml up -d
bun install --cwd local
bun run compact:build --zk
bun run live:check
```

Lace: Settings > Midnight > network Undeployed, with the node at http://localhost:9944, the indexer at http://localhost:8088/api/v4/graphql and the proof server at http://localhost:6300. Then give it Night from the chain's genesis wallet:

```
bun local/fund.ts <the mn_addr_undeployed... address Lace shows under Receive>
```

On localhost, the menu also offers Undeployed. `docker compose -f local/compose.yml down`
removes the development chain and indexer state together; the next start creates a fresh chain.

Without Lace: `bun local/bridge.ts` serves a genesis wallet on this machine, and the page opened as `http://localhost:3000/?wallet=http://127.0.0.1:8790&network=undeployed` connects to it in place of Lace. `bun run live:check` uses two genesis wallets, registers their Night for DUST if needed, plays every street to showdown, and verifies that both stacks and bonds return to the wallets.

The optional `local/build-indexer.sh` and `local/indexer.sh` run the indexer on the host;
start only the `node` and `proof-server` Compose services when using those scripts.
