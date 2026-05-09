---
root: true
targets: ["*"]
description: tenex agent contract — read first
globs: ["**/*"]
---

# tenex — agent contract

This is a TypeScript monorepo. Bun + Turborepo + Hono on Cloudflare Workers + Vite/React frontend + oRPC contracts. Domain-driven, contract-first.

Read this file before doing anything. Then read `docs/ubiquitous-language.md` for cross-context terminology.

## Layout (memorize this)

```
apps/api          # @app/api          — Hono on Workers, mounts the oRPC router
apps/web          # @app/web          — Vite + React + React Query
packages/contracts        # @package/contracts        — oRPC contract definitions
packages/shared-kernel    # @package/shared-kernel    — small primitives
packages/domains/<ctx>    # @domain/<ctx>            — one bounded context per package
packages/tooling/{biome,tsconfig}
```

## Hard rules

1. **Package = bounded context.** New domain logic creates a new `packages/domains/<context>/` package; never adds a folder to an existing context unless the new term belongs to that context's ubiquitous language.
2. **No cross-domain imports.** `domains/X` cannot import from `domains/Y`. If two contexts need to coordinate, use `@package/contracts` (sync) or domain events through `@package/shared-kernel` (async).
3. **Contract-first.** Every new procedure: define in `packages/contracts/src/<context>/`, implement in `packages/domains/<context>/src/interface/`, consume in `apps/web` via `orpc.<context>.<procedure>`.
4. **`domain/` and `application/` are framework-free.** No Hono, no oRPC, no Cloudflare types. Pass dependencies as interfaces (`Clock`, `Repo`, etc.).
5. **`interface/` is the only oRPC entry point in a domain package.** It implements the contract and delegates to use-cases.
6. **Glossary discipline.** Every term in code under `packages/domains/<ctx>/` must be in that context's `glossary.md` AND `.cspell/glossary.txt`. cspell runs with `addWords: false`; new terms require a glossary edit in the same PR.
7. **TypeScript strict everywhere.** `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on. Use `import type` for type-only imports.
8. **Biome over ESLint+Prettier.** `bun run lint` runs biome. Don't add ESLint plugins.

## Quick commands

| Goal | Command |
|---|---|
| Install | `bun install` |
| Dev (all) | `bun run dev` |
| Dev (one app) | `bun --filter @app/api dev` / `bun --filter @app/web dev` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` (`bun run lint:fix` to apply) |
| Spellcheck | `bun run spell` |
| Test | `bun run test` |
| Full check | `bun run check` |
| Regenerate AI files | `bun run rulesync` |
| Deploy api | `bun --filter @app/api run deploy` |
| Push secrets to prod Workers | `bun --filter @app/api run secrets:push` |
| Export secrets to .dev.vars | `bun --filter @app/api run secrets:export` |

## When asked to add a feature

1. **Understand the domain.** Ask: which bounded context? If the term isn't in any context's `glossary.md`, that's a signal — either it belongs to an existing context (add to glossary), or it needs a new context.
2. **Write the contract first.** Add the procedure in `packages/contracts/src/<context>/`. Tests of the contract shape come for free via Zod.
3. **Implement domain + application.** Pure functions. No frameworks.
4. **Wire interface.** Implement the procedure handler; delegate to use-cases.
5. **Wire frontend.** `useQuery(orpc.<context>.<procedure>.queryOptions(...))`. The type lights up automatically.
6. **Run `bun run check` before declaring done.**

## When asked to debug or refactor

- Don't add features beyond what was asked. Don't introduce abstractions for hypothetical future needs.
- If you find a bug, fix the root cause in the application/domain layer, not by patching the interface.
- Don't write comments that restate what the code does. Only write a comment when WHY is non-obvious.
