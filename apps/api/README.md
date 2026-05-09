# @app/api

Hono server on Cloudflare Workers. Mounts the oRPC router at `/rpc/*`.

## Local dev

```sh
cp .dev.vars.example .dev.vars   # fill in values
bun --filter @app/api dev
```

The router is composed in `src/router.ts` from each domain's `interface/`. `src/index.ts` wires Hono → `RPCHandler` and supplies the request-scoped context (clock, db, auth claims). To add a new bounded context: add a workspace dep in `package.json`, import its `interface/`, splice into `router`.

## Deploy

```sh
bun --filter @app/api run deploy
bun --filter @app/api run secrets:put   # uploads everything in .dev.vars to Workers
```

D1 / KV / R2 bindings are commented out in `wrangler.toml` — uncomment and fill in IDs once provisioned.
