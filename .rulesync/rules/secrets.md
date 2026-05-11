---
targets: ["*"]
description: Secrets management via .dev.vars + wrangler secrets
globs: ["apps/**", ".dev.vars*", "wrangler.toml", "package.json"]
---

# Secrets

Plain environment variables, no external secrets service. One file: `apps/api/.dev.vars` (gitignored). Wrangler reads it natively for local dev. The same file is uploaded as Cloudflare Worker secrets at deploy time.

## Local dev

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars   # one-time, then fill in values
bun run dev                                        # turbo runs both apps
```

`apps/api/scripts/dev` fails fast if `.dev.vars` is missing. `apps/api/.dev.vars.example` is the canonical inventory of every var the Worker reads — comments inline document how to obtain each.

`apps/web` consumes no secrets directly. The SPA calls the api via same-origin `/rpc/*` in prod and the Vite proxy in dev.

## CI / deploy

`bun run deploy` runs `scripts/deploy`, which:

1. Auto-provisions D1 / KV / R2 if the `wrangler.toml` placeholders are still in place.
2. Applies every D1 migration to the remote prod database.
3. Uploads `apps/api/.dev.vars` to the prod Worker via `wrangler secret bulk --env=prod`.
4. Builds the SPA and deploys the Worker.

For secret-only updates (no code redeploy):

```sh
bun --filter @app/api run secrets:put
# or, single var:
cd apps/api && bunx wrangler secret put VAR --env=prod
```

## Adding a secret

1. Add `KEY=value` to `apps/api/.dev.vars`.
2. Add `KEY=` (blank) plus a comment to `apps/api/.dev.vars.example` so the next person knows the var exists.
3. If consumed at type-check time, declare it on the `Env` interface in `apps/api/src/index.ts`.
4. Restart `bun run dev` — wrangler reads `.dev.vars` only at startup.

## Don't

- Don't commit `.dev.vars` (gitignored — keep it that way).
- Don't put secrets in `[vars]` blocks in `wrangler.toml`. Those are plain text in deployments. Use them for non-secret config only (`ENVIRONMENT`, public callback URLs, allow-list origins).
- Don't add `dotenv` packages. `wrangler dev` already loads `.dev.vars` into `c.env`.
- Don't use Cloudflare Secrets Store as the primary store; it's beta and lacks a local-dev story.
