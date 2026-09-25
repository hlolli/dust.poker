# dust.poker

## Development

Bun for everything: `bun install`, `bun dev` (`scripts/dev.ts`: the page with hot reload, and the proving keys under `/deal`), `bun test`, `bun run typecheck`, `bun run build`. Run `bun run check` before committing. Tests sit next to the code as `*.test.ts` and use `bun:test`. No npm, pnpm, yarn, vitest or vite.

Layout:

- `src/index.html`, `src/main.ts` -- entry: the menu, then the room. `src/room.ts` builds the scene and the renderer and is, with the `src/ui/` layer, the only code that touches `document`. All HTML styling lives in `src/index.html`
- `src/ui/` -- the browser's HTML layer: `menu.ts` the main menu (profiles, Practice, Lace with the network choice, join or deploy a table), `creator.ts` the character creator (a live preview; build, skin, outfit, height), `backdrop.ts` the menu's fragment-shader night (plain WebGL2), `profiles.ts` the profiles in local storage (name, look, the Live identity secret), `actions.ts` the bar of controls fixed to the bottom of the page; the 3D rail in `src/scene/rail.ts` serves headsets only
- `src/scene/` -- Three.js: room, table, seats, chips (`chips.ts`, instanced piles for stacks, bets and the pot), rail controls, avatars (base characters in `models.ts`, a player's look applied by `look.ts` as a repaint of the body texture, the dealer redressed by `dealer.ts`), `text.ts` canvas labels that shrink and wrap to fit, digits on a fixed advance; `lounge.ts` is the generated Web Audio band at the bar, one set per UTC hour, playing by the wall clock
- `src/poker/` -- pure TypeScript poker: cards, hand ranking, payouts, bots; no Three.js, no I/O. The betting rules live in the contract, not here
- `src/referee/` -- the `TableState` / `act()` seam; `rules.ts` is everything read off the contract's ledger (phases, the steps a seat owes, what is legal, the table as the scene sees it), shared by both referees; `contract.ts` runs the compiled deal contract in memory with bots in the other seats (the Practice table)
- `src/live/` -- the Live table's chain side, no Three.js: `wallet.ts` the DApp connector handshake with Lace and the Bech32m address decoder; `ledger.ts` transactions (deploy, a call from a local circuit run, its payouts as outputs) on `@midnightntwrk/ledger-v9`, with `ledger.test.ts` applying them to a ledger state in memory; `indexer.ts` the GraphQL reads; `chain.ts` the `Chain` a Live table plays on (snapshot, submit) and its wallet-backed implementation; `referee.ts` the Live referee, which does its own seat's steps as transactions and watches the chain for the rest; `local.ts` a chain in memory for tests, `referee.test.ts` two clients playing a deal on it; `live.ts` deploy and join through the wallet. `ledger-shim.js` loads the ledger's wasm in the browser like `src/compact/onchain-runtime-shim.js` does the runtime's
- `src/compact/` -- the shim that loads the on-chain runtime's wasm in the browser; `scripts/wasm-plugin.ts` points the runtime's package name at it for the dev server (`bunfig.toml`) and the site build (`scripts/build-site.ts`)
- `src/assets/textures/` -- CC0 PBR sets from ambientCG; `src/assets/avatars/` -- Rocketbox characters converted to GLB; every asset is listed with its licence in `LICENSES.md`, add there when adding assets
- `scripts/convert-avatar.py` (Blender, headless) converts one Rocketbox FBX folder to a GLB with 1K WebP textures and the 52 ARKit shape keys; `scripts/convert-avatars.sh` runs it over a folder of them. Raw Rocketbox downloads stay out of the repo.
- `contracts/*.compact` -- the Midnight contracts (the referee); `contracts/build/` is compiler output, not committed. `contracts/client.ts` is what a player's client computes from the ledger (reading cards, the five to show, the pot split); the tests and the benchmark take their witnesses from it
- `scripts/` -- `fetch-compact.ts` downloads the compiler version pinned in package.json `config.compactc` into `.compact/`; `build-contracts.ts` compiles every contract (`--zk` also builds proving keys)
- `local/` -- the Midnight network on this machine (README, "A Midnight network on your machine"): `compose.yml` the node and proof server, `build-indexer.sh` and `indexer.sh` the indexer built from source (`indexer.yaml` its config), `fund.ts` Night from the genesis wallet through the wallet SDK, `wallet.ts` a seed wallet in the DApp connector's shape, `table.ts` the end-to-end run without Lace (two such wallets open a table and play a deal through `src/live`), `bridge.ts` one of them over HTTP for the browser (`src/live/bridge-wallet.ts` puts it under `window.midnight` when the page has `?wallet=<url>`). Its own `package.json`: the wallet SDK is a tool here, not a site dependency. `bin/`, `data/` and `.indexer-src/` are build output and state, not committed
- `docs/adr/` decisions, `CONTEXT.md` glossary, `docs/agents/` skill config

Contracts: `bun run compact:build` before `bun test`; `bun run check` does it. Contract tests live next to the source (`contracts/*.test.ts`) and run the compiled circuits locally through `@midnight-ntwrk/compact-runtime`, no chain, no proof server.

Proving: `bun run prover:build` (needs nix) builds Midnight's wasm prover and the matching native `zkir` key generator into `.compact/prover/`; `bun run compact:build --zk` then generates prover keys into `contracts/build/<name>/keys/`; `bun run bench:prove` proves the dealing circuits and prints times. `bun run prover:build-native` builds the same prover as a native binary (`prover/native/`, output `.compact/prover-native/prove`) and `bun run bench:prove --native` times it on the same preimages. `zkir mock-compile <file.zkir>` prints a circuit's exact row count. Never generate keys with the `zkir-v3` binary bundled with compactc; the wasm prover does not read them. `bun run prove:deal` is the proof gate: it plays deals locally until every circuit has run, then proves each with the wasm prover; `.github/workflows/prove.yml` runs it on every push to master (nix builds the prover on a cache miss). `contracts/harness.ts` is the local table the tests, the benchmark and the gate share.

Root holds only files that must be there (package.json, bun.lock, bunfig.toml, tsconfig.json, vercel.json, LICENSE, README.md, AGENTS.md, CONTEXT.md).

## Agent skills

### Issue tracker

Issues live as GitHub issues in `hlolli/dust.poker`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
