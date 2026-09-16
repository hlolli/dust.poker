# dust.poker

## Development

Bun for everything: `bun install`, `bun dev` (dev server, hot reload), `bun test`, `bun run typecheck`, `bun run build`. Run `bun run check` before committing. Tests sit next to the code as `*.test.ts` and use `bun:test`. No npm, pnpm, yarn, vitest or vite.

Layout:

- `src/index.html`, `src/main.ts` -- entry; the only place that touches `document` and the renderer
- `src/scene/` -- Three.js: room, table, seats, rail controls, avatars; `lounge.ts` is the generated Web Audio lounge loop, positioned at the bar
- `src/poker/` -- pure TypeScript poker: cards, hand ranking, payouts, bots; no Three.js, no I/O. The betting rules live in the contract, not here
- `src/referee/` -- the `TableState` / `act()` seam; `contract.ts` runs the compiled deal contract locally with bots in the other seats (the Practice table; the live one adds a chain and proofs)
- `src/live/` -- the Live table's chain side; `wallet.ts` is the DApp connector handshake with Lace and the Bech32m address decoder, no Three.js
- `src/compact/` -- the shim that loads the on-chain runtime's wasm in the browser; `scripts/wasm-plugin.ts` points the runtime's package name at it for the dev server (`bunfig.toml`) and the site build (`scripts/build-site.ts`)
- `src/assets/textures/` -- CC0 PBR sets from ambientCG; `src/assets/avatars/` -- Rocketbox characters converted to GLB; every asset is listed with its licence in `LICENSES.md`, add there when adding assets
- `scripts/convert-avatar.py` (Blender, headless) converts one Rocketbox FBX folder to a GLB with 1K WebP textures and the 52 ARKit shape keys; `scripts/convert-avatars.sh` runs it over a folder of them. Raw Rocketbox downloads stay out of the repo.
- `contracts/*.compact` -- the Midnight contracts (the referee); `contracts/build/` is compiler output, not committed. `contracts/client.ts` is what a player's client computes from the ledger (reading cards, the five to show, the pot split); the tests and the benchmark take their witnesses from it
- `scripts/` -- `fetch-compact.ts` downloads the compiler version pinned in package.json `config.compactc` into `.compact/`; `build-contracts.ts` compiles every contract (`--zk` also builds proving keys)
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
