# Bun + Turborepo

Package layout, workspace rules, and the commands you'll use most. For a high-level architecture view, see [`../architecture/README.md`](../architecture/README.md).

## Table of contents

- [Workspace layout](#workspace-layout)
- [Adding a package](#adding-a-package)
- [Dependency direction](#dependency-direction)
- [Turbo task graph](#turbo-task-graph)
- [Bun specifics](#bun-specifics)

## Workspace layout

```
apps/<name>/                  # @app/<name>            — runtime apps (api, web, ...)
packages/<name>/              # @package/<name>        — shared libraries (contracts, shared-kernel)
packages/domains/<ctx>/       # @domain/<ctx>          — bounded contexts
packages/tooling/<name>/      # @tooling/<name>        — shared configs and bin scripts
```

The npm scope reflects the role:

| Scope | Role |
|---|---|
| `@app` | Runtime applications |
| `@package` | General-purpose shared libraries |
| `@domain` | Bounded contexts (DDD) |
| `@tooling` | Shared configs and bin scripts |

Workspace root `package.json` includes:

```json
{
  "workspaces": ["apps/*", "packages/*", "packages/domains/*", "packages/tooling/*"]
}
```

## Adding a package

1. Create the directory under the matching workspace root.
2. Add a `package.json`:
   - `"name": "@<scope>/<name>"`
   - `"private": true`
   - `"type": "module"`
   - `"main"` and `"types"` pointing at `./src/index.ts` (no build step for internal packages)
3. Add a `tsconfig.json` extending the right `@tooling/tsconfig/<variant>.json`.
4. Add `dependencies` using `workspace:*` for siblings.
5. If it's a leaf package, add a reference to the root `tsconfig.json`.
6. `bun install`.

## Dependency direction

```
apps  →  packages/contracts, packages/shared-kernel, packages/domains/*, packages/tooling/*
packages/domains/*  →  packages/contracts, packages/shared-kernel, packages/tooling/*
packages/contracts  →  packages/shared-kernel, packages/tooling/*
packages/shared-kernel  →  packages/tooling/*
```

`shared-kernel` is intentionally tiny. Resist adding helpers; it should grow only when a primitive is needed by 3+ contexts.

## Turbo task graph

`turbo.json` declares the task graph:

| Task | Depends on | Caches |
|---|---|---|
| `build` | `^build` | `dist`, `.next`, `.wrangler`, `.vinxi` |
| `dev` | `^build` | (cache: false, persistent) |
| `typecheck` | `^build` | `*.tsbuildinfo` |
| `test` | `^build` | `coverage` |
| `clean` | — | (cache: false) |

`^build` means "run `build` in dependencies first". For most workflows you won't think about turbo — `bun run check` orchestrates everything from the root.

## Bun specifics

- **Native TS.** Bun runs `.ts` files directly; there's no compile step for internal packages.
- **`bun:test` not `vitest`.** All tests use Bun's built-in test runner. Add `"@types/bun"` and `"types": ["bun"]` to a package's tsconfig if it has tests.
- **`workspace:*` resolution.** Bun symlinks workspace packages into each consumer's `node_modules/`. The `bin` field of any workspace dep gets symlinked into `node_modules/.bin/` and is on PATH for `package.json` scripts (this is how `with-secrets` works).
- **`bun --filter <pattern>`.** Scope a command to specific workspace packages: `bun --filter '@app/*' typecheck`.
- **`bun add -d <pkg>`** at the workspace root adds a dev dependency to the root `package.json`. Drop into a subdir to install at that package level.

## Don't

- Don't compile internal packages to `dist/` for consumption — TS path resolution + bun handles it.
- Don't import from `dist/` paths.
- Don't use `peerDependencies` for internal deps.
- Don't add a `build` script to internal packages unless they ship as a published artifact.
