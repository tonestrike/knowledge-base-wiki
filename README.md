# tenex

TypeScript monorepo. Bun + Turborepo + Hono + oRPC + Cloudflare Workers + Vite/React on the frontend. Domain-driven, contract-first.

## Layout

```
apps/
  api/                            # Hono on Cloudflare Workers, mounts the oRPC router
  web/                            # Vite + React + React Query, consumes contracts
packages/
  contracts/                      # @package/contracts — oRPC contract definitions (the seam)
  shared-kernel/                  # ids, Result, Clock — small, deliberate
  domains/
    <bounded-context>/            # one package per bounded context
      src/domain/                 # entities, value objects, events
      src/application/            # use-cases, command/query handlers
      src/infrastructure/         # adapters, repository implementations
      src/interface/              # oRPC procedure handlers (implement contracts)
      glossary.md                 # ubiquitous language for THIS context
      .cspell/glossary.txt        # cspell dictionary for THIS context
  tooling/
    biome/                        # @tooling/biome
    tsconfig/                     # @tooling/tsconfig
docs/
  ubiquitous-language.md          # cross-context glossary + context map
```

## Quick commands

```sh
bun install
bun run dev            # all apps
bun --filter api dev
bun --filter web dev
bun run typecheck
bun run check          # typecheck + test across the workspace
bun run lint           # biome
bun run spell          # cspell
bun run rulesync       # regenerate CLAUDE.md / AGENTS.md / .codex / .cursor from .rulesync/
```

## Conventions

- **One package per bounded context.** Turborepo's package boundary IS the DDD context boundary; cross-context imports go through `@package/contracts` or `@package/shared-kernel`.
- **Contract-first.** Procedures are defined in `packages/contracts`, implemented in each domain's `interface/`. Frontend imports only from `@package/contracts`.
- **Linguistic DDD.** Each context has its own `glossary.md` and cspell dictionary with `addWords: false` — adding a new term requires a glossary edit in the PR.
- **No cross-domain imports.** `domains/X` cannot import from `domains/Y`. Share via the kernel or via published events.

## AI tooling

This repo is set up to work with both **Claude Code** and **Codex** (CLI + Desktop). Source of truth lives in `.rulesync/`; running `bun run rulesync` regenerates `CLAUDE.md`, `AGENTS.md`, `.claude/`, and `.codex/`. Skills live in `skills/<name>/SKILL.md` and are symlinked into both `.claude/skills/` and `.codex/skills/` (the SKILL.md format is byte-identical between the two).

See `AGENTS.md` (generated) for the full agent contract, and [`docs/ai-tooling/`](docs/ai-tooling/README.md) for the skills + plugins inventory.

## Docs

The full knowledge base lives at [`docs/`](docs/README.md). Start there if you're new — it has reading order, architecture overview, DDD rules, stack reference, ops runbooks, ADRs, and how-to guides.
