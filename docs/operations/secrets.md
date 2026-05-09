# Secrets — Infisical

How tenex manages secrets locally and at deploy time. Driven by [Infisical](https://infisical.com), with per-repo Machine Identity auth so multiple Infisical accounts coexist on one machine.

## Table of contents

- [Layout in Infisical](#layout-in-infisical)
- [Auth model](#auth-model)
- [The `with-secrets` wrapper](#the-with-secrets-wrapper)
- [Local dev](#local-dev)
- [Deploy](#deploy)
- [Adding a secret](#adding-a-secret)
- [Don't](#dont)

## Layout in Infisical

One Infisical project (`tenex`, workspaceId pinned in [`.infisical.json`](../../.infisical.json)).

| Path | Used by |
|---|---|
| `/` | shared cross-cutting secrets (e.g. `SENTRY_DSN`) |
| `/apps/api` | api-only secrets (DB URL, auth signing keys) |
| `/apps/web` | web-only secrets (public env vars consumed at build time) |
| `/packages/shared` | reserved for future shared-kernel secrets if needed |

Environments: `dev`, `staging`, `prod` (the free-tier maximum). The `--recursive` flag on `infisical run` pulls parent-folder secrets too, so each app sees its scoped folder + the root.

## Auth model

We do **not** use `infisical login` — that's machine-global and only one account at a time, which collides with multi-account workflows. Instead: a Universal-Auth Machine Identity per repo, with credentials in shell env vars.

In `~/.zshrc`:

```sh
export INFISICAL_CLIENT_ID_TENEX=<universal-auth-client-id>
export INFISICAL_CLIENT_SECRET_TENEX=<universal-auth-client-secret>
```

How to create the Machine Identity: in the Infisical dashboard for this project, **Access Control → Machine Identities → Create**. Choose Universal Auth, give it Developer access to the `tenex` project, copy the client ID and client secret.

Other repos use their own `INFISICAL_CLIENT_*_<REPO>` pair, so logins never conflict.

## The `with-secrets` wrapper

[`packages/tooling/scripts/bin/with-secrets`](../../packages/tooling/scripts/bin/with-secrets) is a tiny bash wrapper that:

1. If `INFISICAL_TOKEN` is already set (CI), uses it directly.
2. Otherwise, exchanges the `INFISICAL_CLIENT_ID_TENEX` + `INFISICAL_CLIENT_SECRET_TENEX` env vars for a token via `infisical login --method=universal-auth`.
3. Execs the requested command with secrets injected via `infisical run`.

It's exposed as a workspace-scoped bin (`@tooling/scripts` package, `bin` field), so any package that depends on `@tooling/scripts` gets `with-secrets` in `node_modules/.bin/`. Bun adds that to PATH for `package.json` scripts automatically.

## Local dev

```sh
bun --filter @app/api dev         # wraps `wrangler dev` with /apps/api dev secrets
bun --filter @app/web dev         # wraps `vite` with /apps/web dev secrets
```

If you need a `.dev.vars` file (Wrangler binding inspection, debugging):

```sh
bun --filter @app/api run secrets:export   # writes apps/api/.dev.vars (gitignored)
```

## Deploy

```sh
bun --filter @app/api run deploy        # wrangler deploy with prod secrets injected
bun --filter @app/api run secrets:push  # uploads prod secrets to Worker bindings
```

For zero-touch sync, use Infisical's **Cloudflare Workers Sync** integration: dashboard → Project → Integrations → Cloudflare Workers, source `/apps/api` env `prod`, dest worker `tenex-api`. Then secrets push automatically on every Infisical change; CI just runs `wrangler deploy`.

## Adding a secret

1. Add it in the Infisical UI at the right path (`/apps/api`, `/apps/web`, or `/`) and env (`dev`/`staging`/`prod`).
2. If the secret is referenced at type-check time, declare it on the `Env` interface in `apps/api/src/index.ts`.
3. Don't commit `.dev.vars`. Don't commit secrets to `wrangler.toml` (the `[vars]` block is for non-secret config only).
4. If you added a NEW path or NEW env, update [Layout in Infisical](#layout-in-infisical) above.

## Don't

- Don't run `infisical login` for this repo. It bypasses the wrapper and pollutes the global auth.
- Don't add per-app Infisical projects — folders inside the one `tenex` project (free tier caps projects at 3).
- Don't add `dotenv` packages; `infisical run` already injects into `process.env`.
- Don't use Cloudflare Secrets Store as the primary store; it's beta and has no good local-dev story.
