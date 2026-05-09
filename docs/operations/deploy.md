# Deploy

Production deploys for `apps/api` (Cloudflare Workers) and `apps/web` (Vite static build, served by the same Worker as Static Assets — see [ADR-0002](../decisions/0002-web-deploy-target.md)).

## Table of contents

- [Prerequisites](#prerequisites)
- [Deploy](#deploy)
- [Rolling back](#rolling-back)

## Prerequisites

- A Cloudflare account, authenticated via `bunx wrangler login` once.
- Production secrets in Infisical at `/apps/api` env `prod` (and `/apps/web` for web build-time vars). See [`secrets.md`](secrets.md).
- A `tenex-api` Worker provisioned (happens automatically on first `wrangler deploy`).

## Deploy

One command ships the whole stack:

```sh
bun --filter @app/api run deploy
```

What the script does:

1. Builds web first: `bun --filter @app/web run build` (vite emits to `apps/web/dist/`).
2. `with-secrets` exchanges `INFISICAL_CLIENT_*_TENEX` for an `INFISICAL_TOKEN`.
3. `infisical run --env=prod --path=/apps/api --recursive` injects production secrets into the env.
4. `wrangler deploy --env=prod` packages and uploads the Worker. The `[env.prod.assets]` block in `wrangler.toml` attaches `apps/web/dist/` as Static Assets; `run_worker_first = ["/rpc/*"]` keeps `/rpc/*` on the api Worker, while every other path is served from the asset bundle, with unmatched paths falling back to `index.html` for SPA client-side routing.

In production, web and api share an origin (`tenex-api.workers.dev` or your custom domain). No CORS in prod; no separate web deploy.

Push secrets explicitly to the Worker (alternative to having them at runtime):

```sh
bun --filter @app/api run secrets:push
```

This pulls secrets from Infisical prod and uploads them as Worker secrets via `wrangler secret bulk --env=prod`.

## Rolling back

```sh
bunx wrangler deployments list --env=prod   # shows recent deploys
bunx wrangler rollback --env=prod --message="rolling back to <id>"
```

Rolling back the api also rolls back the web bundle, since both ship in the same Worker version.

## Pre-deploy checklist (manual for now)

- [ ] `bun run check` is green
- [ ] Migrations (when D1 is in use) have been run
- [ ] No new secrets are required that aren't already in Infisical prod
- [ ] CHANGELOG / commits are reasonably descriptive

When this hardens, automate via a `deploy-checklist` skill (see [`../ai-tooling/skills.md`](../ai-tooling/skills.md)).
