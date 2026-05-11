# How to add a secret

For all secret management mechanics, see [`../operations/secrets.md`](../operations/secrets.md). This is the short checklist.

## Table of contents

1. [Add the value to `.dev.vars`](#1-add-the-value-to-devvars)
2. [Document it in `.dev.vars.example`](#2-document-it-in-devvarsexample)
3. [Declare the type](#3-declare-the-type)
4. [Use it in code](#4-use-it-in-code)
5. [Push to prod](#5-push-to-prod)

## 1. Add the value to `.dev.vars`

```
KEY=value
```

Edit `apps/api/.dev.vars` directly. It's gitignored.

## 2. Document it in `.dev.vars.example`

Add the same `KEY=` (blank value) to `apps/api/.dev.vars.example` with a comment explaining what the var is and how to obtain it. This file IS committed — it's what the next contributor copies from.

## 3. Declare the type

If the secret is consumed at type-check time by `apps/api`, add it to the `Env` interface in `apps/api/src/index.ts`:

```ts
type Env = {
  ENVIRONMENT: string;
  AUTH_SECRET: string;        // ← new
  // ...
};
```

For non-secret prod config (e.g. a public callback URL), prefer `[env.prod.vars]` in `wrangler.toml` instead of `.dev.vars`.

## 4. Use it in code

```ts
// apps/api: bound to the request context
app.get('/...', (c) => {
  const secret = c.env.AUTH_SECRET;
  // ...
});
```

If `bun --filter @app/api dev` was already running, restart it — `wrangler dev` reads `.dev.vars` at startup only.

## 5. Push to prod

```sh
bun --filter @app/api run secrets:put
```

Or for a single value:

```sh
cd apps/api
bunx wrangler secret put AUTH_SECRET --env=prod
```

## Don't

- Don't `console.log` secrets, even in dev. Logs go to `wrangler tail`.
- Don't commit `.dev.vars`.
- Don't add a secret to `[vars]` in `wrangler.toml` — that's plain text in deployments.
