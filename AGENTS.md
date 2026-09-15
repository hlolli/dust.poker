# dust.poker

## Development

Bun for everything: `bun install`, `bun dev` (dev server, hot reload), `bun test`, `bun run typecheck`, `bun run build`. Run `bun run check` before committing. Tests sit next to the code as `*.test.ts` and use `bun:test`. No npm, pnpm, yarn, vitest or vite.

Layout:

- `src/index.html`, `src/main.ts` -- entry; the only place that touches `document` and the renderer
- `src/scene/` -- Three.js: room, table, seats, rail controls, avatars
- `src/poker/` -- pure TypeScript poker: cards, hand ranking, payouts, bots; no Three.js, no I/O
- `src/referee/` -- the `TableState` / `act()` seam and its implementations (practice, live)
- `src/assets/textures/` -- CC0 PBR sets from ambientCG; `src/assets/avatars/` -- Rocketbox characters converted to GLB; every asset is listed with its licence in `LICENSES.md`, add there when adding assets
- `scripts/convert-avatar.py` (Blender, headless) converts one Rocketbox FBX folder to a GLB with 1K WebP textures and the 52 ARKit shape keys; `scripts/convert-avatars.sh` runs it over a folder of them. Raw Rocketbox downloads stay out of the repo.
- `contracts/*.compact` -- the Midnight contracts (the referee); `contracts/build/` is compiler output, not committed
- `scripts/` -- `fetch-compact.ts` downloads the compiler version pinned in package.json `config.compactc` into `.compact/`; `build-contracts.ts` compiles every contract (`--zk` also builds proving keys)
- `docs/adr/` decisions, `CONTEXT.md` glossary, `docs/agents/` skill config

Contracts: `bun run compact:build` before `bun test`; `bun run check` does it. Contract tests live next to the source (`contracts/*.test.ts`) and run the compiled circuits locally through `@midnight-ntwrk/compact-runtime`, no chain, no proof server.

Proving: `bun run prover:build` (needs nix) builds Midnight's wasm prover and the matching native `zkir` key generator into `.compact/prover/`; `bun run compact:build --zk` then generates prover keys into `contracts/build/<name>/keys/`; `bun run bench:prove` proves the dealing circuits and prints times. `bun run prover:build-native` builds the same prover as a native binary (`prover/native/`, output `.compact/prover-native/prove`) and `bun run bench:prove --native` times it on the same preimages. `zkir mock-compile <file.zkir>` prints a circuit's exact row count. Never generate keys with the `zkir-v3` binary bundled with compactc; the wasm prover does not read them.

Root holds only files that must be there (package.json, bun.lock, tsconfig.json, vercel.json, LICENSE, README.md, AGENTS.md, CONTEXT.md).

## Agent skills

### Issue tracker

Issues live as GitHub issues in `hlolli/dust.poker`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
