# Deploy

Production deploys for `apps/api` (Cloudflare Workers) and `apps/web` (Vite static build, deployment target TBD).

## Table of contents

- [Prerequisites](#prerequisites)
- [Deploy api](#deploy-api)
- [Deploy web](#deploy-web)
- [Rolling back](#rolling-back)

## Prerequisites

- A Cloudflare account, authenticated via `bunx wrangler login` once.
- Production secrets in Infisical at `/apps/api` env `prod` (and `/apps/web` for web build-time vars). See [`secrets.md`](secrets.md).
- A `tenex-api` Worker provisioned (happens automatically on first `wrangler deploy`).

## Deploy api

```sh
bun --filter @app/api run deploy
```

Steps the script does:

1. `with-secrets` exchanges `INFISICAL_CLIENT_*_TENEX` for an `INFISICAL_TOKEN`.
2. `infisical run --env=prod --path=/apps/api --recursive` injects production secrets into the env.
3. `wrangler deploy` packages and uploads the Worker. Build-time secret references resolve from the env.

Push secrets explicitly to the Worker (alternative to having them at runtime):

```sh
bun --filter @app/api run secrets:push
```

This pulls secrets from Infisical prod and uploads them as Worker secrets via `wrangler secret bulk`. Useful if you want a snapshot of secrets bound to a specific Worker version.

## Deploy web

`apps/web` is a Vite SPA. Build:

```sh
bun --filter @app/web run build
```

Output lands in `apps/web/dist/`. Deployment target isn't pinned yet — options:

- **Cloudflare Pages.** `bunx wrangler pages deploy apps/web/dist --project-name=tenex-web`
- **Cloudflare Workers static assets.** Newer pattern, attaches static assets to the api Worker.
- **Any static host.** Vercel, Netlify, S3 — `dist/` is just static files.

When we settle on one, pin it here and add an ADR.

## Rolling back

### Api

```sh
bunx wrangler deployments list   # shows recent deploys
bunx wrangler rollback --message="rolling back to <id>"
```

### Web

Depends on host. For Cloudflare Pages, the dashboard has a one-click rollback to a previous deployment.

## Pre-deploy checklist (manual for now)

- [ ] `bun run check` is green
- [ ] Migrations (when D1 is in use) have been run
- [ ] No new secrets are required that aren't already in Infisical prod
- [ ] CHANGELOG / commits are reasonably descriptive

When this hardens, automate via a `deploy-checklist` skill (see [`../ai-tooling/skills.md`](../ai-tooling/skills.md)).
