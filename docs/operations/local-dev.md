# Local development

Day-one setup and the most common commands. For why each tool was chosen, see [`../architecture/README.md`](../architecture/README.md).

## Table of contents

- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Pre-commit hook](#pre-commit-hook)
- [Stable HTTPS URLs via portless (optional)](#stable-https-urls-via-portless-optional)
- [Common commands](#common-commands)
- [Filtering by package](#filtering-by-package)
- [Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Bun | ≥ 1.3.0 | `curl -fsSL https://bun.sh/install \| bash` |
| Node.js | ≥ 22 (pinned in `.nvmrc`) | `nvm install 22 && nvm use 22`, or system install |
| Cloudflare account | any | sign up at cloudflare.com (only needed for `wrangler deploy`) |
| Infisical Machine Identity | one per repo | see [`secrets.md`](secrets.md) |

The Infisical CLI ships as a workspace devDep (`@infisical/cli`); no global install required.

> **Node + wrangler:** wrangler's local dev mode (used by `bun --filter @app/api dev`) requires real Node.js to run its ProxyWorker controller channel. Under bun's node-shebang fallback, the controller IPC breaks silently and HTTP requests hang on `:8787`. Make sure `node --version` returns `v22.x` in the shell where you run dev — the lazy-load nvm pattern in `~/.zshrc` only exposes `node` after you've called it once in the session; eager `nvm use` (or `bun run setup`, which does it for you) sidesteps this.

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

## Pre-commit hook

`bun install`'s postinstall wires a `pre-commit` hook via [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks). On every `git commit` the hook runs [`scripts/pre-commit`](../../scripts/pre-commit), which:

1. `biome check --write --staged` — lint + format on the staged files only; auto-fixes are re-staged so they land in the same commit.
2. `cspell` on staged `.ts` / `.tsx` / `.md` files.

If you need to commit despite the hook (mid-refactor stash, intentional doc-only WIP):

```sh
git commit --no-verify -m "..."
```

Use sparingly — CI runs the same gate via `bun run check`, so anything bypassed locally still has to pass on push.

## Stable HTTPS URLs via portless (optional)

[`portless.json`](../../portless.json) at the repo root wires both apps for [vercel-labs/portless](https://github.com/vercel-labs/portless), which proxies named `*.localhost` URLs through HTTPS+HTTP/2 instead of port numbers. After a one-time install, `portless` runs both dev servers and exposes them at:

- `https://web.tenex.localhost` → `apps/web` (vite on :5173)
- `https://api.tenex.localhost` → `apps/api` (wrangler on :8787)

One-time setup (binds privileged port 443, mutates `/etc/hosts`, and generates and trusts a local CA — sudo will prompt):

```sh
npm install -g portless
portless                      # from the repo root; first run does the privileged setup
```

After that, `portless` (no args) starts both dev servers behind the proxy. Stop with Ctrl+C.

The vite proxy in [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts) keeps targeting `http://localhost:8787` directly — that path is unchanged, so the SPA's `/rpc/*` requests still flow through vite to wrangler in-process. portless is purely a friendlier surface for opening the apps in a browser.

`portless` and `bun --filter @app/{api,web} dev` are interchangeable; they bind the same ports (8787/5173) and share the same secret-fetching path through `with-secrets`, so you can pick whichever fits the moment without reconfiguring anything.

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
