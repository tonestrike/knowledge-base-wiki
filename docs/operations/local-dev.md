# Local development

Day-one setup and the most common commands. For why each tool was chosen, see [`../architecture/README.md`](../architecture/README.md).

## Table of contents

- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Common commands](#common-commands)
- [Filtering by package](#filtering-by-package)
- [Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Bun | ≥ 1.3.0 | `curl -fsSL https://bun.sh/install \| bash` |
| Cloudflare account | any | sign up at cloudflare.com (only needed for `wrangler deploy`) |
| Infisical Machine Identity | one per repo | see [`secrets.md`](secrets.md) |

The Infisical CLI ships as a workspace devDep (`@infisical/cli`); no global install required.

## First-time setup

```sh
git clone <repo>
cd tenex
bun run setup
```

`setup` is idempotent. It:

1. Verifies `bun >= 1.3.0`.
2. Runs `bun install` (which fans out `rulesync generate` via `postinstall` — `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `.agents/` appear locally; gitignored, with `.rulesync/` as the source of truth).
3. Detects whether `INFISICAL_CLIENT_ID_TENEX` and `INFISICAL_CLIENT_SECRET_TENEX` are already exported in `~/.zshrc`. If both are present, it skips the prompt; otherwise it prompts for the missing one(s) and appends `export` lines to the rc.
4. Smoke-tests the Machine Identity by exchanging the creds for a token via `with-secrets` and pulling secrets from `/apps/api`.
5. Runs `bun run check`.

To target a different shell rc (e.g. `~/.bashrc`), set `SETUP_SHELL_RC` before running:

```sh
SETUP_SHELL_RC=~/.bashrc bun run setup
```

If new exports were appended, open a new shell or `source` the rc so the creds persist.

How to obtain the Machine Identity client ID + secret: see [`secrets.md`](secrets.md#auth-model).

## Common commands

| Goal | Command |
|---|---|
| Install deps | `bun install` |
| Start API + web together | `bun run dev` |
| Start one app | `bun --filter @app/api dev` or `bun --filter @app/web dev` |
| Run all checks | `bun run check` |
| Auto-fix lint + format | `bun run fix` |
| Type-check only | `bun run typecheck` |
| Lint only | `bun run lint` |
| Spell-check only | `bun run spell` |
| Tests only | `bun run test` |
| Regenerate AI rule files | `bun run rulesync` |
| Deploy api | `bun --filter @app/api run deploy` |
| Push prod secrets to Workers | `bun --filter @app/api run secrets:push` |
| Export dev secrets to `.dev.vars` | `bun --filter @app/api run secrets:export` |
| Clean everything | `bun run clean` |

## Filtering by package

Bun's `--filter` flag scopes commands to one workspace package:

```sh
bun --filter @app/api dev
bun --filter '@package/*' typecheck   # all packages under @package
bun --filter '@domain/core' test
```

Combine with turbo when you want dependency-aware execution:

```sh
turbo run typecheck --filter=@app/api    # also typechecks anything @app/api depends on
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `with-secrets: command not found` | `node_modules/.bin/` not on PATH | Run via `bun run` script — bun adds bins automatically |
| `INFISICAL_CLIENT_ID_TENEX must be set` | Missing in `~/.zshrc` or shell hasn't sourced | `source ~/.zshrc`; create the Machine Identity if needed |
| `cspell: Unknown word (X)` | Term not in glossary | Add to the relevant `.cspell/glossary.txt` AND `glossary.md` |
| `tsc error in src/.../X.test.ts` | `bun:test` types missing | Add `"@types/bun": "^1.2.18"` and `"types": ["bun"]` to the package's tsconfig |
| `bun run check` is slow | Cold turbo cache | Subsequent runs cache typecheck/test outputs; check cache hits |
| Port 8787 / 5173 in use | Previous dev server didn't shut down | `lsof -i :8787` then `kill <pid>` |
