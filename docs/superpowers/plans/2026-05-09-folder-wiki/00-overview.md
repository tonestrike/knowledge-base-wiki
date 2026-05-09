# folder-wiki Implementation Plan — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Tenex FDE take-home — *Compile a Folder into an LLM Wiki* with three creative leaps (adaptive `WikiSchema`, generative `Artifact` answers, span-verifying lint loop) — as a deployed app, public repo with README, and 10–20 min unlisted YouTube video, all in service of one client promise: knowledge you can trust.

**Architecture:** Contract-first DDD on Bun + Turborepo. Hono-on-Workers for sync oRPC; Durable Objects for the multi-minute Compile, the WebSocket Chat stream, and the per-Claim Lint pass. Four bounded contexts (`ingestion`, `wiki`, `chat`, `verification`) coordinate only via `@package/contracts` Zod schemas (sync) and `@package/shared-kernel` domain events (async). Eight named agents with explicit per-agent model picks; **Verifier is on Opus 4.7** to defeat self-grading bias against the Sonnet-driven Compiler. The web app runs the full demo against contract mocks the moment Phase 0.1 lands so Phase 2's five backend tracks can fan out in parallel and re-converge on those mocks.

**Tech Stack:** Bun 1.3.x, Turborepo 2.x, Hono 4.x, oRPC 1.14.x (`@orpc/contract`, `@orpc/server`, `@orpc/client`, `@orpc/tanstack-query`), Zod 3.x, Cloudflare Workers + Durable Objects + D1 + R2 + KV + Cron Triggers, Vite 6.x + React 19 + TanStack Query 5.x, Tailwind 3.x + shadcn/ui (Radix), Framer Motion 11.x, react-markdown + remark, pdfjs-dist 4.x, Recharts 2.x, Shiki 1.x, `@anthropic-ai/sdk` 0.40.x, `googleapis` 144.x for Drive, Biome 1.9.x, cspell 8.x, Infisical CLI for secrets.

---

## Plan index

| Slice | File | Phase | Depends on | Demo Moment |
|---|---|---|---|---|
| 0.1 Contract spike | [`0.1-contract-spike.md`](0.1-contract-spike.md) | 0 (gating) | — | enables all |
| 1.A Risk spike | [`1.A-risk-spike.md`](1.A-risk-spike.md) | 1 (gating) | 0.1 | informs 2.A, 2.D |
| 1.B DDD scaffolding | [`1.B-ddd-scaffolding.md`](1.B-ddd-scaffolding.md) | 1 (parallel after 1.A) | 0.1, 1.A | enables 2 |
| 1.C UI bootstrap | [`1.C-ui-bootstrap.md`](1.C-ui-bootstrap.md) | 1 (parallel after 1.A) | 0.1, 1.A | sets up 1+2+3 |
| 2.A ingestion | [`2.A-ingestion.md`](2.A-ingestion.md) | 2 (parallel) | 0.1, 1.B | feeds 1 |
| 2.B wiki | [`2.B-wiki.md`](2.B-wiki.md) | 2 (parallel) | 0.1, 1.B | 1 |
| 2.C chat | [`2.C-chat.md`](2.C-chat.md) | 2 (parallel) | 0.1, 1.B | 2 |
| 2.D verification | [`2.D-verification.md`](2.D-verification.md) | 2 (parallel) | 0.1, 1.B | 3 |
| 2.E web UI | [`2.E-web-ui.md`](2.E-web-ui.md) | 2 (parallel) | 0.1, 1.C | renders 1+2+3 |
| 3.1 Mock-swap + e2e | [`3.1-mock-swap.md`](3.1-mock-swap.md) | 3 | 2.A–2.E | proves <5min integration |
| 3.2 Demo curation | [`3.2-demo-curation.md`](3.2-demo-curation.md) | 3 | 3.1 | locks 1+2+3 |
| 4.1 Deploy | [`4.1-deploy.md`](4.1-deploy.md) | 4 | 3.2, Q5 | live link |
| 4.2 Record | [`4.2-record.md`](4.2-record.md) | 4 | 4.1 | the deliverable |
| 4.3 Submit | [`4.3-submit.md`](4.3-submit.md) | 4 | 4.2 | done |

```
Phase 0   0.1 contract spike (single track, gating)
              │
Phase 1   1.A risk spike (gating; informs 2.A and 2.D)
              ├──────────────┐
              ▼              ▼
              1.B DDD scaffolding   1.C UI bootstrap   (parallel, after 1.A)
              ├──────────────┘
              ▼
Phase 2   2.A ingestion ─ 2.B wiki ─ 2.C chat ─ 2.D verify ─ 2.E web   (5-way parallel)
              └─────────── all rendezvous on contract mocks from 0.1 ──┘
Phase 3   3.1 mock-swap + e2e ──▶ 3.2 demo curation
Phase 4   4.1 deploy ──▶ 4.2 record ──▶ 4.3 submit
```

## Conventions all slices follow

- **Repo root:** `/Users/tonyvantur/Development/projects/tenex/`. All paths in plans are repo-relative unless absolute is necessary.
- **Add a glossary term BEFORE writing code that uses it.** Add to `packages/domains/<ctx>/glossary.md` AND `packages/domains/<ctx>/.cspell/glossary.txt` in the same commit. cspell `addWords: false` will fail the check otherwise. (Rule: `.rulesync/rules/domain-driven.md`.)
- **Contract-first.** Every new procedure: define in `packages/contracts/src/<ctx>/<resource>.ts`, compose in `packages/contracts/src/<ctx>/index.ts`, re-export at `packages/contracts/src/index.ts`, implement in `packages/domains/<ctx>/src/interface/index.ts`, mount in `apps/api/src/router.ts`, consume in `apps/web` via `orpc.<ctx>.<procedure>`.
- **Layering.** `domain/` (entities, value objects, events — pure) → `application/` (use-cases — pure functions, deps injected as interfaces) → `infrastructure/` (Cloudflare adapters, Anthropic SDK, googleapis) → `interface/` (oRPC handlers, Durable Objects). `domain/` and `application/` MUST be framework-free.
- **Shared types.** Cross-context types (`Span`, `Citation`, `Claim`, `WikiSchema`, `Artifact`, `AnswerSegment`, `PageType`, `Relation`) live in `packages/contracts/src/shared/` as Zod schemas, re-exported by each context's contract module. Domains never import from `domains/<other>`; they import shared types via `@package/contracts/shared`.
- **Domain events.** Five events flow through `@package/shared-kernel/events`: `SourceIngested`, `SchemaInferred`, `CompileFinished`, `AnswerProduced`, `CorrectionAccepted`. Schemas are in `@package/contracts/events`. The bus is an injected `EventBus` interface; in v1 the production binding is a Cloudflare Queue, in tests it's an in-memory bus.
- **Tests.** `bun:test`. Co-locate as `*.test.ts` next to the source. Pure functions in `domain/` and `application/` get unit tests; oRPC handlers in `interface/` get a single shape-conformance test that asserts the contract roundtrip with a fake context. Determinism-sensitive tests (the lint planted-contradiction case) run 10× and assert all pass.
- **Imports.** `import type` for type-only imports (`verbatimModuleSyntax` is on). `@tooling/tsconfig`'s `allowImportingTsExtensions` means imports use the literal `.ts` extension everywhere internally.
- **`bun run check` is the gate.** Lint + spell + typecheck + test. Every slice ends with it green. CI runs the same on every PR.
- **Commits per task.** Every plan task ends with a `git add` + `git commit` step. Conventional-commits prefix: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`. Every commit message mentions the slice ID (e.g. `feat(2.B): ...`).
- **Frontends and backends rendezvous on contract mocks.** Phase 1.C and every Phase 2 backend slice consume the SAME `@package/contracts/<ctx>/mocks` factories defined in Phase 0.1. Web tests in Phase 2.E use these mocks via MSW to keep the demo working end-to-end while backends are still landing.

## Model selection (locked per spec §2.4)

| Agent | Model ID | Rationale |
|---|---|---|
| SchemaInferrer | `claude-sonnet-4-6` | Schema judgement quality matters; not high-volume (one inference per Compile). |
| Planner | `claude-haiku-4-5-20251001` | Mechanical decomposition. |
| Researcher (×N) | `claude-haiku-4-5-20251001` | High volume, per-Source. Sonnet's price hits hard at fan-out. |
| Drafter | `claude-sonnet-4-6` | Prose quality is the surface a reader judges. |
| Linker | `claude-haiku-4-5-20251001` | Mechanical relation matching. |
| IndexBuilder | `claude-haiku-4-5-20251001` | Mechanical aggregation. |
| Synthesizer | `claude-sonnet-4-6` | Picks Artifact + composes streamed Answer; quality-critical. |
| Verifier | `claude-opus-4-7` | **Different family from Sonnet.** Defeats self-grading bias on Compile-time output. |

These IDs go in env vars (`ANTHROPIC_MODEL_SCHEMA`, `ANTHROPIC_MODEL_PLANNER`, etc.) so they can be swapped without code changes.

## Branch strategy

- All work lands on `main` via PR per slice. Slice branch name: `feat/<slice-id>-<kebab>`. Example: `feat/0.1-contract-spike`, `feat/2.B-wiki`.
- Phase 1.A is a throwaway spike branch — never merged; the Risk Report it produces is committed to `main` separately as a one-line append to `docs/projects/folder-wiki/spec.md` §5.
- Phase 2 PRs are reviewed with `pr-review-toolkit:review-pr` before merge. Contract-touching slices (0.1, 1.B, 2.A–2.D) additionally run `pr-review-toolkit:silent-failure-hunter` and `pr-review-toolkit:type-design-analyzer`.

## Self-review checkpoint between phases

After each phase completes, run a five-minute self-review against [`spec.md`](../../../projects/folder-wiki/spec.md):
1. Does each Done-when bullet have a green check in the slice's PR?
2. Did anything land that doesn't serve one of the three Demo Moments (storyboard.md)?
3. Did any new term get used in code without showing up in a `glossary.md` + `.cspell/glossary.txt` entry?

Cut anything that fails any of those three before opening the next phase.

## Execution handoff

After this plan is approved:

**1. Subagent-Driven (recommended for Phase 1 and Phase 2 fan-outs)** — Use superpowers:dispatching-parallel-agents in Phase 1 (3 slices on disjoint scopes) and superpowers:subagent-driven-development in Phase 2 (5 slice-implementer agents, fresh subagent per task, two-stage review).

**2. Inline Execution** — Use superpowers:executing-plans, batch within a phase with checkpoints between phases.

**Phase 0.1 is authored together — not delegated.** It IS the contract everything else integrates against; quality here is the ceiling for everything downstream. (Per project memory `take-home-direction.md`, "atomic level where everything could be built and integrated in <5 minutes because the interfaces are so well-designed" is the North Star — and that only happens if the contracts spike is co-authored.)

**Phase 1 ordering:** 1.A runs first as a gating spike — its findings on Drive auth, per-doc latency, citation accuracy, and Verifier determinism feed prompt and pricing decisions in 2.A and 2.D. Once 1.A's Risk Report is appended to `spec.md` §5.1.1, 1.B and 1.C dispatch in parallel via `superpowers:dispatching-parallel-agents`. Phase 2's five tracks dispatch in parallel via `superpowers:subagent-driven-development`. Phase 3 and 4 are sequential.
