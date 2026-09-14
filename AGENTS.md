# dust.poker

## Development

Bun for everything: `bun install`, `bun dev` (dev server, hot reload), `bun test`, `bun run typecheck`, `bun run build`. Run `bun run check` before committing. Tests sit next to the code as `*.test.ts` and use `bun:test`. No npm, pnpm, yarn, vitest or vite.

Layout:

- `src/index.html`, `src/main.ts` -- entry; the only place that touches `document` and the renderer
- `src/scene/` -- Three.js: room, table, seats, rail controls, avatars
- `src/poker/` -- pure TypeScript poker: cards, hand ranking, payouts, bots; no Three.js, no I/O
- `src/referee/` -- the `TableState` / `act()` seam and its implementations (practice, live)
- `contracts/*.compact` -- the Midnight contracts (the referee); `contracts/build/` is compiler output, not committed
- `scripts/` -- `fetch-compact.ts` downloads the compiler version pinned in package.json `config.compactc` into `.compact/`; `build-contracts.ts` compiles every contract (`--zk` also builds proving keys)
- `docs/adr/` decisions, `CONTEXT.md` glossary, `docs/agents/` skill config

Contracts: `bun run compact:build` before `bun test`; `bun run check` does it. Contract tests live next to the source (`contracts/*.test.ts`) and run the compiled circuits locally through `@midnight-ntwrk/compact-runtime`, no chain, no proof server.

Root holds only files that must be there (package.json, bun.lock, tsconfig.json, vercel.json, LICENSE, README.md, AGENTS.md, CONTEXT.md).

## Agent skills

### Issue tracker

Issues live as GitHub issues in `hlolli/dust.poker`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
