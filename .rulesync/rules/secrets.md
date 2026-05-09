---
targets: ["*"]
description: Secrets management via Infisical
globs: ["apps/**", ".dev.vars*", "wrangler.toml", "package.json"]
---

# Secrets — Infisical

Source of truth: one Infisical project `tenex` (workspaceId in `.infisical.json` at the repo root) with envs `dev`, `staging`, `prod`. Folders mirror the monorepo: `/apps/api`, `/apps/web`, `/packages/shared`. Cross-cutting secrets live at `/` and folders use Secret Imports / `--recursive` to inherit.

## Auth model — Machine Identity (the convention)

Each repo gets a per-repo Machine Identity in Infisical, and the contributor exports its credentials in their shell rc with a `_<REPO>` suffix so multiple repos coexist without collision:

```sh
# in ~/.zshrc (or equivalent)
export INFISICAL_CLIENT_ID_TENEX=<uuid>
export INFISICAL_CLIENT_SECRET_TENEX=<hex>
```

`bun run setup` checks both are present and prompts for whichever is missing. `packages/tooling/scripts/bin/with-secrets` reads them, exchanges them for an `INFISICAL_TOKEN` via `infisical login --method=universal-auth`, and execs the wrapped command under `infisical run --token=<TOKEN>`.

**Agents and ad-hoc scripts should always go through `with-secrets`** (or invoke a package.json script that does):

```sh
# good — declarative, picks up the right env from package.json
bun --filter @app/api dev

# good — explicit, the same wrapper, when you need one-off injection
./packages/tooling/scripts/bin/with-secrets --env=dev --path=/ --recursive -- bun some/script.ts

# fallback — when even with-secrets isn't available (e.g. throwaway worktree
# whose package.json scripts don't yet route through it), inline the dance:
TOKEN=$(infisical login --method=universal-auth \
  --client-id="$INFISICAL_CLIENT_ID_TENEX" \
  --client-secret="$INFISICAL_CLIENT_SECRET_TENEX" \
  --plain --silent) && \
infisical run --token="$TOKEN" \
  --projectId="$(jq -r .workspaceId .infisical.json)" \
  --env=dev --path=/ --recursive -- <command>
```

The `--projectId` flag is required when invoking `infisical run` with `--token` from a subdirectory or a worktree where `.infisical.json` discovery doesn't fire. Pull it from the repo-root `.infisical.json`.

The shell-rc creds (`INFISICAL_CLIENT_ID_TENEX` / `INFISICAL_CLIENT_SECRET_TENEX`) are NOT propagated through `bun run` / turbo by default. `turbo.json`'s `globalPassThroughEnv` lists them so they reach package scripts; if you add a new task that needs them, append it there, don't try to re-export inside the task.

If `INFISICAL_CLIENT_ID_TENEX` is missing from your shell rc but the secret is set, `bun run setup` will prompt for it and `setup` is idempotent — re-run it any time. The Machine Identity ID is visible in the Infisical dashboard under Access Control → Identities.

## Local dev

Run `infisical login` once (web flow, for the dashboard). Then:

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
