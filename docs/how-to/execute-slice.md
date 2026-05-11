# How to execute a slice

When a slice of an existing project doc is ready to ship, this is the workflow. If you're routed here from the `monorepo` skill, follow the steps verbatim.

## Table of contents

1. [Phase 1 — Read](#phase-1--read)
2. [Phase 2 — Architect (if needed)](#phase-2--architect-if-needed)
3. [Phase 3 — Implement](#phase-3--implement)
4. [Phase 4 — Verify](#phase-4--verify)
5. [Phase 5 — Update the project doc](#phase-5--update-the-project-doc)
6. [What good looks like](#what-good-looks-like)
7. [Failure modes](#failure-modes)

## Phase 1 — Read

Before touching any file:

1. Read the **whole project doc** — not just the target slice. Goal, Why now, Out of scope, Open questions all constrain what the slice can do.
2. Read the **prior slices' completion notes** — they often capture decisions or gotchas the target slice depends on.
3. Read any rules-files relevant to the slice's scope:
   - Adding a bounded context → [`../ddd/bounded-contexts.md`](../ddd/bounded-contexts.md), [`../ddd/linguistic-discipline.md`](../ddd/linguistic-discipline.md)
   - Adding a procedure → [`../stack/orpc.md`](../stack/orpc.md)
   - Adding a secret → [`../operations/secrets.md`](../operations/secrets.md)
   - Frontend → [`../stack/orpc.md`](../stack/orpc.md), [`../stack/typescript.md`](../stack/typescript.md)
4. Confirm the slice's **Depends on** list is satisfied. If a dependency isn't done, stop and surface it.

## Phase 2 — Architect (if needed)

If the slice's text says "use `feature-dev:code-architect`" — or if you find yourself unsure how to proceed because the slice has unresolved design questions — invoke `feature-dev:code-architect` with a brief that includes:

- The slice's goal and Done-when criteria, copied verbatim
- The relevant constraints (Cloudflare Workers, bun, oRPC contract-first, DDD layering)
- Any open questions the slice flagged

The architect produces a blueprint. **Read it.** Decide. Push back on anything that violates the always-on rules. Don't implement straight from a blueprint without reviewing it — the agent designed it; you decide whether it's right.

If the slice has no architectural unknowns, skip this phase.

## Phase 3 — Implement

Order matters. Take these in sequence:

1. **Glossary changes first.** New term anywhere in the slice → add to the relevant `glossary.md` AND `.cspell/glossary.txt` (per-context if it belongs to a context, shared `docs/glossary.txt` only for cross-cutting words).
2. **Contracts second.** New procedure → define in `@package/contracts/<ctx>/` first. The procedure shape is the seam; types from it light up downstream.
3. **Domain + application third.** Pure functions, dependencies injected as interfaces. No Hono, oRPC, Cloudflare types.
4. **Infrastructure fourth.** Adapters that implement the application-layer interfaces. Talk to D1, KV, R2, external APIs here.
5. **Interface fifth.** oRPC procedure handlers in `packages/domains/<ctx>/src/interface/index.ts`. Thin — unpack context, delegate to use-case, map errors. No logic.
6. **Frontend sixth.** Use-cases via `orpc.<ctx>.<procedure>.queryOptions(...)` / `mutationOptions(...)`.
7. **Tests as you go.** Each use-case gets a `*.test.ts` next to it; integration tests for any infrastructure adapter.

Skip steps that don't apply (e.g., a frontend-only slice doesn't touch contracts or domain).

## Phase 4 — Verify

Run:

```sh
bun run check
```

This runs `lint && spell && typecheck && test`. If any step fails, fix it. The CI gate runs the same command; if it passes locally, it'll pass in CI 99% of the time.

Common failures and fixes:

| Failure | Fix |
|---|---|
| `cspell: Unknown word (X)` | Add `X` to the relevant glossary (per-context if it's domain-y, shared `docs/glossary.txt` if it's cross-cutting writing) |
| `tsc error: Cannot find module '@package/X'` | Add `@package/X` to the consuming package's `dependencies` as `workspace:*`; run `bun install` |
| `biome: useImportType` | Change `import { Foo }` to `import type { Foo }` for type-only imports |
| `bun:test` cannot find type declarations | Add `"@types/bun"` and `"types": ["bun"]` to the package's `tsconfig.json` |
| `apps/api/.dev.vars not found` | `cp apps/api/.dev.vars.example apps/api/.dev.vars` and fill in values (see [`../operations/secrets.md`](../operations/secrets.md)) |

For UI changes, also visually verify in the browser. `bun run check` doesn't catch broken layouts.

## Phase 5 — Update the project doc

Once the slice is green, **before committing**:

1. In the project doc, change the slice header from no status to:
   ```markdown
   **Status:** Done (commit `<sha>`, [run `<run-id>`](optional GH link)).
   ```
2. Tick all the Done-when checkboxes (`[ ]` → `[x]`).
3. If you discovered something the project doc didn't capture (a constraint, a gotcha, an unanticipated subtlety), add a short paragraph under the slice — the next slice's executor will thank you.
4. If the slice produced an ADR, add a row to [`../decisions/README.md`](../decisions/README.md)'s index.

Then commit, push, and confirm CI is green.

## What good looks like

Slice 1 of `docs/projects/0001-finish-scaffolding.md` is a worked example. The completion notes there capture two real-world fixes (`Node 22` rulesync issue, `Ashby/wordlists` cspell hits) that the original blueprint didn't anticipate. That's the right shape: project doc gets richer as slices land.

## Failure modes

| Failure | Cause | Fix |
|---|---|---|
| Wrote handlers before contracts | Skipped Phase 3 step 2 ordering | Stop, define the contract, refactor — type errors will guide you |
| Used a term in code that's not in any glossary | Skipped Phase 3 step 1 | Add to glossary + cspell dict; rerun `bun run spell` |
| `bun run check` passes locally but CI fails | Local has a tool/version your environment provides that CI doesn't | Run `bun install --frozen-lockfile` locally to match CI; check Node-version-sensitive tooling (rulesync was a real example) |
| Slice grew beyond its scope | Author kept adding things | Stop, finish what's in the slice's Done-when, open the rest as a follow-up slice |
| Skipped updating the project doc | Forgot Phase 5 | Always — closes the loop for the next reader |
| Architect blueprint had a flaw, executor didn't catch it | Implemented from blueprint without review | The architect designs; you decide. Push back when something violates the always-on rules |
