# Secrets

Plain environment variables, no external secrets service. One file per app for local dev (`.dev.vars`); the same file is uploaded as Cloudflare Worker secrets for production.

## Table of contents

- [Where secrets live](#where-secrets-live)
- [Local dev](#local-dev)
- [Production](#production)
- [Adding a secret](#adding-a-secret)
- [Don't](#dont)

## Where secrets live

| Location | Used by | Notes |
|---|---|---|
| `apps/api/.dev.vars` | wrangler dev (local) | dotenv format. Gitignored. Auto-loaded by `wrangler dev`. |
| Cloudflare Workers secrets (env `prod`) | production | Uploaded from `apps/api/.dev.vars` via `wrangler secret bulk`, or one at a time with `wrangler secret put`. |
| `apps/api/wrangler.toml` `[env.<x>.vars]` block | non-secret config | `ENVIRONMENT`, `GOOGLE_OAUTH_REDIRECT` (the prod URL), `WEB_APP_ORIGINS` (allow-list). Plain text — visible in deploys. |

`apps/web` consumes no secrets directly: the SPA calls the api via same-origin `/rpc/*` in production (the Worker serves both routes and assets), and via the Vite proxy in local dev. There is no `.env` for the web app.

## Local dev

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
# fill in real values — the file documents each var inline
bun run dev
```

`apps/api/scripts/dev` fails fast with a friendly message if `.dev.vars` is missing.

If a runtime error mentions `OAUTH_TOKEN_KEY_BASE64`, you missed that one — generate a fresh key with `openssl rand -base64 32` and paste it in.

## Production

`bun run deploy` uploads `apps/api/.dev.vars` to the prod Worker as part of the deploy. If you want to push secret changes without re-deploying code:

```sh
bun --filter @app/api run secrets:put
```

That runs `wrangler secret bulk --env=prod .dev.vars`. To rotate or add one secret without touching the rest:

```sh
cd apps/api
bunx wrangler secret put SOME_VAR --env=prod
# interactive prompt — paste the value
```

If you'd rather not reuse the same values for dev and prod, keep a separate `.prod.vars` file (gitignored — add it to `.gitignore` if you do) and pass that file path to `wrangler secret bulk` instead.

## Adding a secret

1. Add the key to `apps/api/.dev.vars` with a real value.
2. Add the same key (with a placeholder + a comment explaining what it is and how to get it) to `apps/api/.dev.vars.example` so the next person knows it exists.
3. If the secret is consumed at type-check time, declare it on the `Env` interface in `apps/api/src/index.ts`.
4. For non-secret config (e.g. a public callback URL), prefer `[env.prod.vars]` in `wrangler.toml` so it's checked in.

## Don't

- Don't commit `.dev.vars` (it's gitignored).
- Don't put secrets in `wrangler.toml`'s `[vars]` blocks — those are plain text in deployments.
- Don't add `dotenv` packages. `wrangler dev` already loads `.dev.vars` into `c.env`.
- Don't use Cloudflare Secrets Store as the primary store; it's beta and has no good local-dev story.
