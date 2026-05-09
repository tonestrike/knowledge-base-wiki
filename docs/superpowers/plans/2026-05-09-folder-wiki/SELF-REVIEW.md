# folder-wiki plans — self-review

Audit performed against the writing-plans skill self-review checklist (spec coverage, placeholder scan, type consistency).

## 1. Spec coverage

Walked every requirement from `docs/projects/folder-wiki/spec.md` and `docs/projects/0002-folder-wiki.md`.

| Requirement | Spec section | Plan(s) |
|---|---|---|
| Adaptive `WikiSchema` + `PageType` + `Relation` | §1, §2.2 | 0.1 (schemas), 2.B (`SchemaInferrer`), 1.C/2.E (chips) |
| Generative `Artifact` answers (closed registry of 8) | §1, §2.2, §4.3 | 0.1 (`ArtifactKind`), 2.C (Synthesizer structured-output enforces it), 1.C/2.E (registry) |
| Span-verifying lint loop on Opus 4.7 | §1, §2.4, §3.5 | 2.D (Verifier on `claude-opus-4-7`, temperature 0; concurrency 6; Cron sampler; planted-contradiction 10/10 gate) |
| 4 bounded contexts (ingestion, wiki, chat, verification) | §2.1 | 1.B (scaffolds), 2.A–2.D (impl) |
| Shared types (`Span`, `Citation`, `Claim`, `WikiSchema`, `Artifact`, `AnswerSegment`) | §2.2 | 0.1 — all six in `@package/contracts/shared` |
| 5 domain events | §2.3 | 0.1 (schemas), emitters in 2.A/2.B/2.C/2.D, subscriptions in 2.B (Task 16a — added during this audit), 2.D (`subscribeCompileFinished`), and chat (`AnswerProduced` emit added in 2.C ConversationDO during this audit) |
| 8 named agents w/ explicit model picks | §2.4 | 2.A (`extractSource` is mechanical, no agent); 2.B (`SchemaInferrer` Sonnet, Planner Haiku, Researcher Haiku, Drafter Sonnet, Linker Haiku, IndexBuilder Haiku); 2.C (Researcher Haiku, Synthesizer Sonnet); 2.D (Verifier Opus 4.7) |
| D1 / R2 / KV / DO / Cron topology | §3 | 2.A (D1+R2+KV bindings), 2.B (`CompileRunDO`), 2.C (`ConversationDO`), 2.D (`LintRunDO` + Cron), 4.1 (production wrangler env) |
| Streaming protocol | §3.3 | 0.1 (`eventIterator` SSE shape), 2.A/2.B/2.C/2.D (DO ↔ SSE bridges), 2.E (`useEventStream` hook) |
| Citation rendering pipeline | §3.4 | 1.C (chip + modal scaffold), 2.E (real PDF.js + outline-driven page mapping) |
| Lint-loop architecture (auto on `CompileFinished`, daily Cron 10%) | §3.5 | 2.D (`subscribeCompileFinished` + `dailyLintSample`) |
| 6 spectacular UI elements (magazine WikiPage, compile theater, citation flight, generative artifacts, lint ribbon, span shimmer) | §4.3 | 1.C (skeletons), 2.E (full polish + visual-diff snapshots) |
| 5 named states (empty/compiling/loading/error/no-results) | §4.4 | 1.C (state primitives), 2.E (gallery includes all) |
| 11 risks (§5.1) | §5.1 | 1.A spike measures 5 of them; the rest are mitigated by design choices in 2.A–2.E (see Risk Report template in 1.A) |
| Q1–Q4 resolved | App. A | Q1/Q3 in 0.1 (Zod at the seam, `AnswerPage` is a subtype of `WikiPage`); Q2 in 1.B (chat is its own pkg); Q4 in 2.D (Verifier on Opus) |
| Q5 (web deploy target) | 0002 | 4.1 (resolves with ADR-0002 → Workers Static Assets) |
| Q6 (single-user OAuth) | 0002 | 1.A spike validates; 2.A implements; 4.1 deploys |
| Q7 (compile feels responsive) | 0002 | 1.A spike measures; 3.2 tunes |

**Coverage gaps found and patched during audit:**
1. `AnswerProduced` was specified but not emitted. **Patched 2.C** to publish from `ConversationDO` after `synthesizeAnswer` resolves.
2. Wiki had no subscription handlers for the three events it consumes. **Patched 2.B** with a new Task 16a that wires `SourceIngested` / `AnswerProduced` / `CorrectionAccepted` subscriptions (log-only stubs in v1; explicit "v1.1: act" markers).

No further gaps.

## 2. Placeholder scan

Searched for `TBD`, `FIXME`, `XXX`, `implement later`, "Add appropriate error handling".

**Findings:**
- The only literal `TODO|FIXME|XXX` match was in `4.3-submit.md` Step 3 — and it's a `grep` instruction telling the user to scan their *own* code at submission time. Not a placeholder.
- `<X>` placeholders in 1.A's Risk Report template, 4.1's `<workers-domain>`, 4.3's `<UNLISTED_YOUTUBE_URL>` / `<LIVE_URL>` / `<org>` are intentional — they're values the executor fills in at run time and we cannot synthesize ahead of time.

No placeholder issues. Plans pass.

## 3. Type consistency

Cross-plan grep on every brand type and procedure name:

```
WikiId × 81 · FolderId × 62 · SourceId × 61 · WikiPageId × 56 · UserId × 36
LintRunId × 32 · CompileRunId × 32 · TurnId × 30 · ConversationId × 30
LintFindingId × 20 · ClaimId × 17 · CitationId × 10
```

Every brand type is referenced in lowercase factory form (`sourceId(...)`) when constructing and PascalCase form (`SourceId`) when type-annotating — consistent across all plans.

**Procedure-name disambiguation** (caught during audit, fixed in 0.1 + propagated to 1.B):
- `wikis.get` and `pages.get` would have clobbered after spread-composition. **Renamed** `getWiki`/`listWikis` and `getPage`/`listPages`. Same fix applied to chat (`getConversation`/`getTurn`/`listConversations`/`listTurns`) and verification (`getLintRun`/`getFinding`/`listLintRuns`/`listFindings`). All references in 1.B's stub routers updated.

**Event names** referenced 13–39× each, all 5 spelled identically.

**Agent constants** (`SCHEMA_MODEL`, `PLANNER_MODEL`, `RESEARCHER_MODEL`, `DRAFTER_MODEL`, `SYNTH_MODEL`, `VERIFIER_MODEL`) all defined in the plan that owns the agent and referenced consistently.

No type-name issues. Plans pass.

## Plan inventory

| Slice | File | Tasks | Lines |
|---|---|---:|---:|
| Overview | `00-overview.md` | (index) | 101 |
| 0.1 Contract spike | `0.1-contract-spike.md` | 23 | 3,075 |
| 1.A Risk spike | `1.A-risk-spike.md` | 5 | 696 |
| 1.B DDD scaffolding | `1.B-ddd-scaffolding.md` | 11 | 938 |
| 1.C UI bootstrap | `1.C-ui-bootstrap.md` | 13 | 1,888 |
| 2.A ingestion | `2.A-ingestion.md` | 15 | 2,078 |
| 2.B wiki | `2.B-wiki.md` | 16 (+1 audit) | 2,338 |
| 2.C chat | `2.C-chat.md` | 14 | 1,374 |
| 2.D verification | `2.D-verification.md` | 12 | 1,214 |
| 2.E web UI | `2.E-web-ui.md` | 9 | 804 |
| 3.1 Mock-swap | `3.1-mock-swap.md` | 7 | 328 |
| 3.2 Demo curation | `3.2-demo-curation.md` | 3 | 204 |
| 4.1 Deploy | `4.1-deploy.md` | 5 | 295 |
| 4.2 Record | `4.2-record.md` | 4 | 199 |
| 4.3 Submit | `4.3-submit.md` | 4 | 260 |
| **TOTAL** | | **141** | **~15,800** |

## Status

**All 14 slice plans are ready for execution.** Phase 0 → 1 → 2 → 3 → 4 with the parallel structure documented in `00-overview.md`:

- 0.1 (gating) — author together
- 1.A (gating) — risk spike, throwaway
- 1.B / 1.C — parallel via `superpowers:dispatching-parallel-agents`
- 2.A / 2.B / 2.C / 2.D / 2.E — 5-way parallel via `superpowers:subagent-driven-development`
- 3.1 → 3.2 → 4.1 → 4.2 → 4.3 — sequential

The plans are self-contained: each Phase 2 plan can be handed to a fresh subagent and executed against the contract mocks defined in 0.1.
