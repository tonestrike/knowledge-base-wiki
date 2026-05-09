# 0002 — Web deploy target

**Date:** 2026-05-09
**Status:** Accepted
**Deciders:** tonyvantur

## Context

`apps/web` is a Vite + React SPA that consumes the api at `/rpc/*` via oRPC. In dev, Vite proxies `/rpc` to `localhost:8787`, where wrangler runs the api. In production, we have nothing pinned — `apps/web/dist/` is just static files, and `docs/operations/deploy.md` lists three plausible hosts with a "TBD" until this ADR.

ADR-0001 §5 already pinned the api to Cloudflare Workers for cost, edge latency, free-tier permanence, and native bindings. The web deploy decision is therefore not "where do we host static files in the abstract" but "where do they sit relative to the Worker that serves the api."

The three options are: Cloudflare Pages (sibling to the Worker), Cloudflare Workers Static Assets attached to the api Worker (same Worker), or a third-party host like Vercel (separate vendor entirely).

## Options considered

- **Option A — Cloudflare Pages.** Mature standalone static-site product. `bunx wrangler pages deploy apps/web/dist --project-name=tenex-web` ships a deploy; preview deploys per branch and one-click rollback come for free. Independent of the api Worker — they deploy, scale, and fail separately. Two deploy artifacts to coordinate; SPA routing needs a `_redirects` file or wrangler config; cross-origin in production unless we wire a custom domain that fronts both. Cloudflare's recent direction has shifted marketing energy from Pages toward Workers Static Assets, but Pages is not deprecated.

- **Option B — Cloudflare Workers Static Assets attached to `apps/api`.** A single `wrangler deploy` ships the api Worker with the contents of `apps/web/dist/` bound as static assets. Web and api share an origin in production, removing CORS entirely; one deploy unit means web and api can never drift. Wrangler exposes `run_worker_first = ["/rpc/*"]` so the api Worker handles only its own routes and everything else is served from the asset bundle (with `not_found_handling = "single-page-application"` falling back to `index.html` for SPA routes). Trade-off: a bad api change atomically takes down the web; deploy and rollback are coupled. This is the platform's recommended path for new full-stack apps.

- **Option C — Vercel (or other third-party static host).** Best-in-class DX (git integration, automatic preview deploys, framework detection); SPA support is automatic. But it splits the stack across two vendors — secrets, observability, billing, and on-call posture all double. The api lives on Cloudflare for the reasons in ADR-0001 §5; putting the web on a different edge network adds a hop on every api call from the browser for no offsetting benefit. Vendor concentration is, at this stage, a feature.

## Decision

**Option B — Workers Static Assets attached to `apps/api`.**

Reasoning, in priority order:

1. **One platform.** ADR-0001 §5 already chose Cloudflare for the api. Putting the web on the same Worker keeps secrets, deploys, observability, billing, and on-call posture in one place. For a solo project that's compounding leverage; multiplying vendors costs operational attention I'd rather spend on features.
2. **One origin.** Same-origin in production deletes a class of CORS, cookie, and CSP friction. The only origin difference left is "dev (5173 → 8787) vs prod (same)", which the existing Vite proxy already abstracts.
3. **One deploy unit.** `bun --filter @app/api run deploy` ships both halves atomically; web and api version drift is impossible by construction.
4. **Aligned with platform direction.** Cloudflare's 2024–2025 messaging treats Static Assets attached to Workers as the recommended shape for full-stack apps; investment is going there. Pages still works but is being maintained, not extended.

The deploy-coupling downside is real but minor at this scale: if the api breaks in production, the web is down too. For a solo project before traffic, that's a feature (atomic deploys mean version drift can't masquerade as a bug). If the project ever grows to where independent deploy cadence matters, splitting back to Pages is an afternoon of wrangler config — the SPA itself doesn't change.

## Consequences

- `apps/api/wrangler.toml` gets an `[env.prod]` block that mirrors `name`/`vars`/`observability` from the top-level and adds `[env.prod.assets]` pointing at `../web/dist`, with `not_found_handling = "single-page-application"` and `run_worker_first = ["/rpc/*"]`. The asset binding only attaches under `--env=prod`; dev (`wrangler dev` against the top-level config) is untouched, so a missing `apps/web/dist/` during dev is a non-event.
- `apps/api`'s `deploy` script becomes the single deploy command for the whole stack: it builds web first (`bun --filter @app/web run build`) and then runs `wrangler deploy --env=prod`. `apps/web` keeps its own `build` script (vite emits to `apps/web/dist/`), but does not own a deploy script — the deploy is delegated to api by design.
- `apps/api`'s `secrets:push` similarly takes `--env prod` so `wrangler secret bulk` lands on the same Worker target.
- The `app.get('/')` placeholder in `apps/api/src/index.ts` is shadowed in production by the `index.html` static asset (assets are checked before falling through to the Worker for any path that isn't covered by `run_worker_first`). The placeholder stays for local-no-web debugging, since dev doesn't bind assets.
- `docs/operations/deploy.md` "Deploy web" section collapses into "Deploy is `bun --filter @app/api run deploy`; the api script builds web first." TBD removed.
- We commit to wrangler ≥ the version that supports `run_worker_first` as a route-pattern array (wrangler 3.95+; we're on 3.99). If wrangler ever regressed that feature, the fallback is a Worker-side fetch handler that explicitly delegates non-`/rpc/*` requests to `env.ASSETS.fetch(request)`.
- If we ever need branch preview deploys, we either add per-branch wrangler environments (more config) or revisit this ADR to move web back to Pages, which has previews built in. Re-opening the decision for that reason is expected.
