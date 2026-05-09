# 0001 — Stack Choice

**Date:** 2026-05-09
**Status:** Accepted
**Deciders:** tonyvantur

## Context

This repo went from empty directory to running scaffold in one focused session: bun + Turborepo + Biome + Hono on Cloudflare Workers + oRPC + Vite/React + Infisical + DDD-with-cspell. Each pick had alternatives, and the reasoning behind the picks lived only in that conversation. This ADR freezes the reasoning so future-me (or a teammate) can read the *why* without re-running the comparisons.

Each section below is its own micro-decision with the same Context → Options → Decision → Consequences shape. They're recorded in one ADR because they're tightly coupled — flipping one usually pulls neighbors with it (Bun ↔ Biome speed expectations; Hono ↔ Cloudflare Workers; oRPC ↔ contract-first DDD).

For the architecture these decisions produce, see [`../architecture/README.md`](../architecture/README.md). For the language layered on top, see [`../ubiquitous-language.md`](../ubiquitous-language.md).

## 1. Bun (vs pnpm + Node + tsx)

**Context.** Solo TypeScript monorepo. Want fast install, native TS execution, a single-binary developer surface, and cheap workspace ergonomics.

**Options.**
- **npm + Node** — default, slow installs, weak workspace UX, requires tsx/ts-node for direct TS execution.
- **pnpm + Node + tsx** — content-addressable store, well-trodden in monorepos, broad ecosystem support. Two binaries (pnpm + node) and TypeScript still goes through a transpiler.
- **Bun** — single binary that is package manager + runtime + test runner + bundler + script runner. Native TS. First-class workspaces.

**Decision.** Bun. One tool replaces three; native TS removes the tsx middle step. Solo project means I can absorb the cost of being on the less-mature path in exchange for a measurably faster inner loop.

**Consequences.** Lockfile is `bun.lock`; CI must pin a Bun version (currently `1.3.6`). Some Node-only libraries (e.g. anything using `process.binding`) need testing under Bun. `bunx --bun` is sometimes required to force runtime when the upstream tool was authored for Node 22+ on a Node 20 host (real example: rulesync — see Slice 1 notes in `docs/projects/0001-finish-scaffolding.md`). If we ever leave Bun, swapping to pnpm is mostly a lockfile + CI change.

## 2. Biome (vs ESLint + Prettier)

**Context.** Need lint + format + import-sort. Want fast, low-config, few moving parts. Don't want a config-sprawl future.

**Options.**
- **ESLint + Prettier (+ plugins)** — the canonical stack. Two configs, slow on big trees, plugin ecosystem is huge but rule churn is constant.
- **dprint + ESLint** — half-and-half, two tools again.
- **Biome** — single Rust binary. Lint + format + import-sort + a11y + JSX. ~10–20× faster than ESLint+Prettier on equivalent rules.

**Decision.** Biome. The cost (smaller rule library than the full ESLint plugin ecosystem) is acceptable for a fresh codebase; speed and one-tool config is worth more than coverage of edge-case rules.

**Consequences.** No access to ESLint plugins (`eslint-plugin-react-hooks`, `eslint-plugin-import`, etc.); Biome covers most equivalents but not all. If a specific rule is critical and Biome doesn't have it, we either accept the gap or selectively bolt on `typescript-eslint` for that one check. The CLAUDE.md explicitly forbids re-introducing ESLint, so any future addition should be deliberate and reviewed.

## 3. Hono (vs Express / Fastify)

**Context.** `apps/api` runs on Cloudflare Workers. Need a router + middleware library that's edge-runtime-native and works with Web standard `Request`/`Response`. Should also run on Bun and Node so local dev and migrations have options.

**Options.**
- **Express** — node-only assumes (`req.headers` shape, `process.nextTick`, etc.). Doesn't run on Workers without heavy adaptation.
- **Fastify** — fast on Node, plugin ecosystem is rich. Cloudflare Workers support is via adapters and not first-class.
- **Hono** — designed for edge runtimes (Workers, Deno, Bun). Web standard primitives, native TS, first-class middleware ecosystem, oRPC has direct integration.

**Decision.** Hono. Same code runs on Workers, Bun, and Node; oRPC's first-class `RPCHandler` lives next to it; the middleware ecosystem is small but growing and has the things we need (CORS, JWT, etc.).

**Consequences.** Tied to Hono's middleware ecosystem (smaller than Express). Switching off Workers but staying on Hono is straightforward. Switching off Hono entirely would require re-wiring the oRPC mount point — single afternoon for the size of router we expect.

## 4. oRPC (vs tRPC)

**Context.** Want end-to-end typed RPC between `apps/web` and `apps/api`, with the option to expose procedures as REST/OpenAPI/MCP/AI tools later. The contract should be the seam between bounded contexts and the frontend (DDD requirement).

**Options.**
- **tRPC** — most popular, mature, very fast TS inference. Tightly coupled to its own client; OpenAPI is via a community plugin.
- **GraphQL** — heavyweight; not justified at this stage.
- **Hand-rolled REST + Zod** — no inference; ergonomic regression vs. either of the above.
- **oRPC** — newer, contract-first via Zod, dual interfaces (RPC + REST out of the box), OpenAPI generation, MCP-aware roadmap.

**Decision.** oRPC. Contract-first matches our DDD layering — the contract IS the seam. OpenAPI/MCP support is a hedge for future external surfaces (mobile, AI tool servers, partner integrations) without re-architecting.

**Consequences.** Smaller community than tRPC; we accept "first to find a bug" risk. Refactors to procedure shape have to round-trip through `@package/contracts` first — exactly the discipline DDD wants but heavier than mutating a tRPC router in place. Frontend consumes contracts only — no direct domain imports.

## 5. Cloudflare Workers (vs AWS Lambda / Vercel)

**Context.** Need a low-latency API tier with reasonable cold-start, low ops, and a free tier suitable for solo development. Want native primitives for KV / SQL / blob storage at the edge.

**Options.**
- **AWS Lambda + API Gateway** — mature, but cold start, IAM complexity, free tier expires after 12 months.
- **Vercel Functions** — DX-friendly but tied to Vercel's deploy and pricing model; cost curve gets steep with traffic.
- **Cloudflare Workers** — V8 isolates, no cold start in the Lambda sense, edge by default, native KV/D1/R2 bindings, generous and permanent free tier.
- **Run-it-yourself on a VPS** — too much ops for solo work; not even worth pricing.

**Decision.** Cloudflare Workers. Lowest ops, best cost curve for a solo project, edge-first, primitives we need are first-class bindings rather than separate services to provision and pay for.

**Consequences.** Constrained runtime: no Node `fs`, no long-running processes, 50ms CPU default per invocation. Code must stay stateless; persistence goes through D1/KV/R2 (already first-class — bindings commented in `wrangler.toml` until a feature wires them). If we ever need long-running compute or process-level state, we add Durable Objects or a side-car — that's a real architectural change worth its own ADR.

## 6. Infisical (vs Doppler / 1Password CLI)

**Context.** Need a secrets manager with: a CLI for local dev, secret scoping per project/environment, a push-to-Workers helper, Machine Identity model for CI, and a free tier that doesn't expire.

**Options.**
- **Doppler** — mature, has Cloudflare integration. Pricing steepens for multi-project use; secret-scoping per project costs extra.
- **1Password CLI** — strong personal credential vault, but project-secret semantics aren't first-class; Workers integration is DIY.
- **AWS Secrets Manager / HashiCorp Vault** — heavyweight; not justified for solo.
- **Infisical** — open-source, generous self-hostable + cloud free tier, Machine Identities for CI/CD, native Cloudflare push.

**Decision.** Infisical. Best fit for solo + multi-project (one Infisical account spans multiple tenex-shaped repos), Machine Identity model maps cleanly to CI, can self-host later if cost or trust ever became a factor.

**Consequences.** `bun --filter @app/api dev` requires a working Machine Identity in Infisical (`with-secrets` wrapper). New developers must onboard via Slice 3's setup script. Vendor lock-in is mild — secrets are the same shape regardless of provider, so a swap is roughly an afternoon's work plus rotation.

## 7. DDD with linguistic-first discipline (vs feature folders)

**Context.** Long-term code clarity. Want bounded contexts to be enforceable, not aspirational. Want the same word to mean the same thing throughout a context, and to NOT silently mean different things across contexts.

**Options.**
- **Feature folders** (`src/feature/<thing>/...`) — standard, low friction, cheap up-front. Context boundaries are convention only; nothing prevents `src/feature/x` from importing from `src/feature/y`.
- **DDD layered, single package** — domain/application/interface/infrastructure folders inside one app. Layering enforced by convention; cross-context imports still possible.
- **DDD with package-per-bounded-context** — each bounded context is its own workspace package. Cross-package imports are explicit; tooling enforces.
- **DDD with linguistic-first discipline** — the above, plus per-context `glossary.md` + cspell `addWords: false` so a new term in code requires a glossary edit in the same PR.

**Decision.** Package-per-bounded-context with linguistic-first discipline. The TypeScript compiler + cspell ARE the architecture enforcers. Folders alone never hold under pressure; a CI gate does.

**Consequences.** Up-front cost: scaffolding a new context is heavier than `mkdir`. Cross-context coordination must go through `@package/contracts` (sync) or events via `@package/shared-kernel` (async) — which is more friction than a function call but is exactly what we want. Glossary edits become part of the development rhythm; that's the point. See [`../ddd/bounded-contexts.md`](../ddd/bounded-contexts.md) and [`../ddd/linguistic-discipline.md`](../ddd/linguistic-discipline.md) for the full rules.
