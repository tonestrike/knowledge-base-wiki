# How to add a secret

For all secret management mechanics, see [`../operations/secrets.md`](../operations/secrets.md). This is the short checklist.

## Table of contents

1. [Decide the path](#1-decide-the-path)
2. [Add it in Infisical](#2-add-it-in-infisical)
3. [Declare the type if needed](#3-declare-the-type-if-needed)
4. [Use it in code](#4-use-it-in-code)

## 1. Decide the path

| If the secret is used by | Path |
|---|---|
| only `apps/api` | `/apps/api` |
| only `apps/web` | `/apps/web` (only secrets that are safe to ship to the browser at build time) |
| multiple apps | `/` (shared) |

For each path, set the value in all environments you need (`dev`, `staging`, `prod`).

## 2. Add it in Infisical

Open the Infisical dashboard for the `tenex` project (workspaceId in `.infisical.json`), navigate to the path, choose the env, set the secret.

If you also want a local override that doesn't go to Infisical, set it in `apps/api/.dev.vars` (gitignored) — `wrangler dev` reads that file.

## 3. Declare the type if needed

If the secret is consumed by `apps/api`, add it to the `Env` interface in `apps/api/src/index.ts`:

```ts
type Env = {
  ENVIRONMENT: string;
  AUTH_SECRET: string;        // ← new
  // ...
};
```

If it's consumed by `apps/web` at build time, declare it in `apps/web/src/vite-env.d.ts` (Vite's standard pattern).

## 4. Use it in code

```ts
// apps/api: bound to context
app.get('/...', (c) => {
  const secret = c.env.AUTH_SECRET;
  // ...
});
```

If `bun --filter @app/api dev` was already running, restart it — the wrapper exchanges new tokens at startup, not on the fly.

## Don't

- Don't `console.log` secrets, even in dev. Logs go to Workers' tail.
- Don't commit `.dev.vars`.
- Don't add a secret to `[vars]` in `wrangler.toml` — that's plain text in deployments.
