# Deploy

Production deploys for `apps/api` (Cloudflare Workers) and `apps/web` (Vite static build, served by the same Worker as Static Assets — see [ADR-0002](../decisions/0002-web-deploy-target.md)).

## Table of contents

- [Prerequisites](#prerequisites)
- [Deploy](#deploy)
- [Rolling back](#rolling-back)
- [Pre-deploy checklist](#pre-deploy-checklist)

## Prerequisites

- A Cloudflare account, authenticated via `bunx wrangler login` once (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env for CI).
- `apps/api/.dev.vars` filled in with the values you want in production. (For real prod-vs-dev separation, see [`secrets.md`](secrets.md#production).)
- A `tenex-api` Worker provisioned (happens automatically on first `wrangler deploy`).

## Deploy

One command ships the whole stack:

```sh
bun run deploy
```

What [`scripts/deploy`](../../scripts/deploy) does, in order:

1. Strips the bun node-shim from PATH and sources nvm if needed (wrangler refuses bun-as-node).
2. Verifies `apps/api/.dev.vars` exists.
3. Auto-provisions D1 / KV / R2 on Cloudflare if `wrangler.toml` still has the `TODO_run_wrangler_*_create` placeholders — runs `wrangler d1 create tenex` / `wrangler kv namespace create CACHE` / `wrangler r2 bucket create tenex` and substitutes the returned IDs back into the toml.
4. Applies every D1 migration under `packages/domains/*/src/infrastructure/migrations/` to the remote prod database, in deterministic domain order (`ingestion → wiki → chat → verification`). Pure CREATE migrations use `CREATE TABLE IF NOT EXISTS`; ALTER migrations that have already been applied are tolerated.
5. Uploads `apps/api/.dev.vars` to the prod Worker via `wrangler secret bulk --env=prod`.
6. Runs `bun --filter @app/web run build` — vite emits to `apps/web/dist/`.
7. Runs `wrangler deploy --env=prod`. The `[env.prod.assets]` block in `wrangler.toml` attaches `apps/web/dist/` as Static Assets; `run_worker_first = ["/rpc/*", "/__source/*", ...]` keeps API routes on the Worker, while everything else falls through to the static asset handler (unmatched paths return `index.html` for SPA routing).

In production, web and api share an origin (`tenex-api.workers.dev` or your custom domain). No CORS in prod; no separate web deploy.

### Push only secrets (no code redeploy)

```sh
bun --filter @app/api run secrets:put
```

That runs `wrangler secret bulk --env=prod .dev.vars`. Useful when you've rotated an API key and don't want to redeploy.

### Update a single secret interactively

```sh
cd apps/api
bunx wrangler secret put SOME_VAR --env=prod
```

## Rolling back

```sh
bunx wrangler deployments list --env=prod   # shows recent deploys
bunx wrangler rollback --env=prod --message="rolling back to <id>"
```

Rolling back the api also rolls back the web bundle, since both ship in the same Worker version.

## Pre-deploy checklist

- [ ] `bun run check` is green
- [ ] D1 migrations work locally (the deploy script applies them remotely, but local sanity first)
- [ ] No new secrets are required that aren't in `.dev.vars`
- [ ] `GOOGLE_OAUTH_REDIRECT` for prod is registered in the Google Cloud Console OAuth client (the deploy script prints a reminder at the end)
- [ ] `WEB_APP_ORIGINS` in `[env.prod.vars]` points at the prod URL so the OAuth callback can redirect there
