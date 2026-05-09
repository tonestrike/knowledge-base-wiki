---
targets: ["*"]
description: Bun + Turborepo monorepo discipline
globs: ["**/package.json", "**/tsconfig.json", "turbo.json"]
---

# Monorepo discipline

## Dependency direction

```
apps  →  packages/contracts, packages/shared-kernel, packages/domains/*, packages/tooling/*
packages/domains/*  →  packages/contracts, packages/shared-kernel, packages/tooling/*
packages/contracts  →  packages/shared-kernel, packages/tooling/*
packages/shared-kernel  →  packages/tooling/*  (only)
```

`shared-kernel` is intentionally tiny. Resist adding helpers to it; it should grow only when a primitive is genuinely needed by 3+ contexts.

## Adding a package

1. Decide direction: app, contract, domain, kernel, tooling.
2. Path under the matching workspace root.
3. `package.json` with:
   - `"name": "@<scope>/<name>"` — `@app` for apps, `@package` for general packages, `@domain` for bounded contexts, `@tooling` for shared configs
   - `"private": true`
   - `"type": "module"`
   - `"main"`/`"types"` pointing at `./src/index.ts` (no build step for internal packages — bun + tsc resolve TS directly through the workspace)
4. `tsconfig.json` extending the right `@tooling/tsconfig/<variant>.json`.
5. `dependencies` use `workspace:*` for sibling packages.
6. Update root `tsconfig.json` references if it's a leaf package.

## Don't

- Don't compile internal packages to dist/ for consumption — TS path resolution + bun handles it.
- Don't import from `dist/` paths anywhere.
- Don't use `peerDependencies` for internal deps.
- Don't add a `build` script to internal packages unless they ship as a published artifact (which, for now, none do).

## Turbo tasks

Only `apps/*` have a `build` script (vite/wrangler). `packages/*` have `typecheck` and (where relevant) `test`. The root `bun run check` fans out across the graph.
