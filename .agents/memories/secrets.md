# Secrets — Infisical

Source of truth: one Infisical project `tenex` with envs `dev`, `staging`, `prod`. Folders mirror the monorepo: `/apps/api`, `/apps/web`, `/packages/shared`. Cross-cutting secrets live at `/` and folders use Secret Imports / `--recursive` to inherit.

## Local dev

Run `infisical login` once. Then:

```sh
bun --filter @app/api dev      # uses `infisical run --path=/apps/api --recursive` under the hood
bun --filter @app/web dev
```

If you need a `.dev.vars` file for `wrangler dev` quirks (e.g. binding inspection), generate it:

```sh
bun --filter @app/api run secrets:export    # writes apps/api/.dev.vars (gitignored)
```

## CI / deploy

Two options, pick one per workflow:

1. **Preferred — managed Workers Sync.** In Infisical: Project → Integrations → Cloudflare Workers. Source `/apps/api` env `prod`, dest worker `tenex-api`. Secrets push automatically on change; CI just runs `wrangler deploy`.
2. **CI-pull fallback.** Use a Machine Identity token (`INFISICAL_TOKEN` env var):
   ```sh
   infisical export --env=prod --path=/apps/api --format=dotenv | wrangler secret bulk
   ```

## Adding a secret

1. `infisical secrets set --env=dev --path=/apps/api KEY=value` (or use the dashboard).
2. If the secret is needed at type-check time, declare it on the `Env` interface in `apps/api/src/index.ts`.
3. Don't commit `.dev.vars`. Don't commit secrets to `wrangler.toml`. The `[vars]` block is for non-secret config only.

## Don't

- Don't add per-app Infisical projects — use folders inside the one `tenex` project (the free tier limits projects to 3).
- Don't introduce `dotenv` packages; `infisical run` already injects into `process.env`.
- Don't use Cloudflare Secrets Store as the primary store; it's beta and lacks a local-dev story.