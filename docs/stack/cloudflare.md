# Cloudflare Workers

`apps/api` runs on Cloudflare Workers. Hono is Workers-native; oRPC's RPCHandler accepts a Workers fetch request directly.

## Table of contents

- [Wrangler config](#wrangler-config)
- [Bindings (D1, KV, R2)](#bindings-d1-kv-r2)
- [Local dev](#local-dev)
- [Deploy](#deploy)
- [Logs and observability](#logs-and-observability)

## Wrangler config

[`apps/api/wrangler.toml`](../../apps/api/wrangler.toml) is the source of truth. Key fields:

```toml
name = "tenex-api"
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]
```

`nodejs_compat` is on so we can use Node-shaped APIs that some libraries assume. Bump `compatibility_date` deliberately when you want new Workers behavior.

## Bindings (D1, KV, R2)

Currently commented out. To provision:

```sh
# D1 — SQLite at the edge
bunx wrangler d1 create tenex
# copy the database_id into wrangler.toml under [[d1_databases]]

# KV — key-value
bunx wrangler kv:namespace create CACHE
# copy the id into wrangler.toml under [[kv_namespaces]]

# R2 — object storage
bunx wrangler r2 bucket create tenex
```

Then uncomment the matching block in `wrangler.toml` and fill in the IDs.

After provisioning, the bindings are accessible on `c.env` in Hono handlers (with `@cloudflare/workers-types` ambient types).

## Local dev

```sh
bun --filter @app/api dev
```

This calls `with-secrets` (Infisical wrapper) → `wrangler dev --env dev`. `wrangler dev` runs the Worker locally on port 8787, with bindings pointing at local stubs by default.

For real bindings during local dev (e.g. you want to hit the real D1), pass `--remote`:

```sh
bun --filter @app/api dev -- --remote
```

## Deploy

```sh
bun --filter @app/api run deploy        # wraps `wrangler deploy` with prod secrets
bun --filter @app/api run secrets:push  # pushes prod secrets to the Worker
```

Or use Infisical's Cloudflare Workers Sync integration for zero-touch secret sync — see [`../operations/secrets.md`](../operations/secrets.md).

## Logs and observability

`[observability]` is enabled in `wrangler.toml`, so traces and metrics ship to Cloudflare's dashboard automatically.

For tail logs:

```sh
bunx wrangler tail tenex-api
```

For local request inspection during dev, the Wrangler UI shows recent requests and bindings.
