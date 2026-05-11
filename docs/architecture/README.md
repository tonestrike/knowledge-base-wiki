# Architecture

A bird's-eye view of tenex. For the language we use (the words this architecture is talking ABOUT), see [`../ubiquitous-language.md`](../ubiquitous-language.md).

## Companion docs

For presentations / walkthroughs:

- [`code-tour.md`](./code-tour.md) — full end-to-end walkthrough of the system, ordered the way a request flows, with file-level pointers and the interesting bugs we hit along the way. Designed to accompany the `/present` deck.
- [`perspective-flow.md`](./perspective-flow.md) — diagrams how the user's perspective text reaches every prompt during compile, plus how the chat picks the lens back up at question time.

## Table of contents

- [Layout](#layout)
- [Dependency direction](#dependency-direction)
- [Runtime topology](#runtime-topology)
- [Why these choices](#why-these-choices)

## Layout

```
apps/
  api/                            # Hono on Cloudflare Workers, mounts the oRPC router
  web/                            # Vite + React 19 + React Query, consumes contracts
packages/
  contracts/                      # @package/contracts — oRPC contract definitions (the seam)
  shared-kernel/                  # @package/shared-kernel — Result, Id, Clock (small, deliberate)
  domains/
    <bounded-context>/            # one package per bounded context
      src/domain/                 # entities, value objects, events
      src/application/            # use-cases (pure functions, deps injected)
      src/infrastructure/         # adapters, repository implementations
      src/interface/              # oRPC procedure handlers (implement contracts)
      glossary.md                 # ubiquitous language — single source of truth
      .cspell/glossary.txt        # cspell dict; addWords:false enforces glossary edits
  tooling/
    biome/                        # @tooling/biome — shared lint/format config
    tsconfig/                     # @tooling/tsconfig — shared TS configs (base/library/react/worker)
    scripts/                      # @tooling/scripts — shared bin scripts (e.g. with-secrets)
docs/                             # this knowledge base (you are here)
.rulesync/                        # source of truth for agent rules
skills/                           # canonical Agent Skills (symlinked into .claude/skills, .codex/skills)
```

## Dependency direction

```
apps  →  packages/contracts, packages/shared-kernel, packages/domains/*, packages/tooling/*
packages/domains/*  →  packages/contracts, packages/shared-kernel, packages/tooling/*
packages/contracts  →  packages/shared-kernel, packages/tooling/*
packages/shared-kernel  →  packages/tooling/*  (only)
```

Cross-domain imports are forbidden. If two contexts need to coordinate, they go through `@package/contracts` (synchronous) or domain events via `@package/shared-kernel` (eventually consistent).

## Runtime topology

```
Browser                  Cloudflare Edge
┌────────────┐    HTTPS  ┌─────────────────────────────────┐
│ apps/web   │  ───────▶ │ apps/api                        │
│ (Vite SPA) │           │  Hono router                    │
│            │           │   /rpc/*  ──▶ RPCHandler        │
│            │           │              │                  │
│            │           │              ▼                  │
│            │           │     oRPC router                 │
│            │           │      ├ core (domain/core)       │
│            │           │      └ <future contexts>        │
│            │           │              │                  │
│            │           │              ▼                  │
│            │           │     use-cases (pure)            │
│            │           │              │                  │
│            │           │              ▼                  │
│            │           │     infrastructure              │
│            │           │      ├ D1 (SQLite at edge)      │
│            │           │      ├ KV  (key-value)          │
│            │           │      └ R2  (object storage)     │
│            │           └─────────────────────────────────┘
└────────────┘
```

`apps/api` is intentionally thin: it composes domain `interface/` routers, supplies request-scoped context (clock, db, auth), and delegates everything else.

## Why these choices

Decisions worth remembering — full reasoning in [ADR-0001](../decisions/0001-stack-choice.md):

- **Bun + Turborepo** over pnpm + Nx: faster, simpler, native TS execution, no compile step for internal packages.
- **Biome** over ESLint + Prettier: one tool, much faster, no config sprawl.
- **Hono** over Express/Fastify: native to Cloudflare Workers, edge-first.
- **oRPC** over tRPC: contract-first, OpenAPI-compatible, supports MCP/AI tool generation.
- **Cloudflare Workers** over Lambda/Vercel: latency, simpler deploy, generous free tier.
- **Infisical** over Doppler / 1Password CLI: open-source, Machine Identities for CI, multi-project free tier.
- **Domain-driven design (linguistic-first)** over layered/feature-folder: language clarity is the leverage point; folder structure reinforces it.
- **Package-per-bounded-context** over folder-per-context: turborepo's import boundary IS the DDD boundary; the compiler enforces it.

ADRs for individual decisions live at [`../decisions/`](../decisions/README.md).
