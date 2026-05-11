# 0002 — folder-wiki

**Status:** Active
**Started:** 2026-05-09
**Done:** —
**Owner:** tonyvantur
**Related:** [design spec](folder-wiki/spec.md), [storyboard](folder-wiki/storyboard.md), bounded-context glossaries — [`@domain/ingestion`](../../packages/domains/ingestion/glossary.md) · [`@domain/wiki`](../../packages/domains/wiki/glossary.md) · [`@domain/chat`](../../packages/domains/chat/glossary.md) · [`@domain/verification`](../../packages/domains/verification/glossary.md), [0001-finish-scaffolding](0001-finish-scaffolding.md), Tenex FDE take-home brief

## Goal

Submit the Tenex Forward Deployed Engineer take-home: a deployed *Compile a Folder into an LLM Wiki* product, a public GitHub repo with a clear `README.md`, and a 10–20 min unlisted YouTube video — implementing Andrej Karpathy's LLM-Wiki pattern (April 2026) with **three creative leaps** in service of one client promise: knowledge you can trust.

1. **Adaptive wiki schema** — the *shape* of knowledge is generated per folder (typed PageTypes + Relations).
2. **Generative artifact answers** — the *retrieval UI* adapts to the question (interactive React components).
3. **Span-verifying lint loop** — every claim is provably grounded; Verifier runs on a different model family from the Compiler to defeat self-grading bias.

Canonical conceptual design: [`folder-wiki/spec.md`](folder-wiki/spec.md). Demo plan: [`folder-wiki/storyboard.md`](folder-wiki/storyboard.md).

## Why now

The take-home is the gate for FDE candidacy. Karpathy's LLM-Wiki gist is one month old; the trajectory-awareness it demonstrates is freshest right now. The submission brief explicitly grades "understanding of LLMs and their trajectory" — implementing this specific pattern + addressing its publicly-known weakness + extending it with two further leaps (adaptive schema, generative artifact answers) is the most-direct demonstration available.

Concrete trigger: assignment is in flight; submission link is waiting. Presentation framing is *as if pitching to a client*, not as an engineering deep-dive (per [`folder-wiki/spec.md`](folder-wiki/spec.md) §1).

## Out of scope

- **OpenAI Realtime / voice mode.** Tempting, but the three leaps already cover technical, presentation, and reliability surfaces; voice doesn't earn its complexity.
- **Graph view of backlinks.** Obsidian-style; cut unless it earns its place in a demo moment.
- **Multi-folder workspaces and cross-folder linking.** Single Folder per Wiki for v1.
- **Auto-update on Drive folder change** (webhooks + incremental compile). Manual re-compile is fine for demo.
- **Vector embeddings as the retrieval substrate.** The wiki *is* the index — agentic search reads it directly. ~100-doc context-fit ceiling acknowledged in the video's trade-offs section.
- **Multi-tenant isolation, per-org workspaces, abuse rate limits.** Single-user OAuth is sufficient for the demo.
- **Embeddings-as-fallback hybrid.** Production move; called out in trade-offs.

## Open questions

Q1–Q4 resolved in [`folder-wiki/spec.md`](folder-wiki/spec.md) Appendix A:

| # | Question | Resolution |
|---|---|---|
| Q1 | Where do `Span` / `Citation` live? | Zod schemas in `@package/contracts`, re-exported per context. |
| Q2 | Is `chat` its own package? | Yes — `Conversation` has durable persistence. |
| Q3 | Are `AnswerPage`s a `WikiPage` subtype? | Yes — alongside Concept / Summary / **Index**. |
| Q4 | Verifier model? | Opus 4.7 (different family from Sonnet to defeat self-grading bias). |

Still pending:

| # | Question | Who decides | By when |
|---|---|---|---|
| Q5 | Where does `apps/web` deploy for the live link? Inherits from `0001` Slice 5 (web deploy ADR). | tonyvantur | before Phase 4 |
| Q6 | Drive auth: single-user OAuth (sufficient for demo) vs per-user. Default single-user. | tonyvantur | Slice 2.A |
| Q7 | Does compile latency at ~20 docs feel responsive (< 60s end-to-end)? Risk-spike result drives a model-selection retread if not. | Slice 1.A result | Slice 1.A |

## Slices

13 atomic slices organized contract-first to maximize parallelism. Phase 0 is gating; Phase 1 runs 3 in parallel; Phase 2 runs 5 in parallel; Phase 3 and Phase 4 are sequential. Detailed conceptual design at [`folder-wiki/spec.md`](folder-wiki/spec.md).

```
Phase 0   0.1 Contract spike (gating; authored together)
Phase 1   1.A Risk spike   ‖   1.B DDD scaffolding   ‖   1.C UI bootstrap
Phase 2   2.A ingest  ‖  2.B wiki+Schema  ‖  2.C chat+Artifact  ‖  2.D verify  ‖  2.E web UI
Phase 3   3.1 mock-swap + e2e   →   3.2 demo curation
Phase 4   4.1 deploy            →   4.2 record   →   4.3 submit
```

### Phase 0 — gating contract spike

#### Slice 0.1 — Contract spike

**Why:** Quality of contracts at this stage determines whether Phase 2 fans out cleanly. **Authored together** — synthesis stays here, not delegated.
**Done when:**
- [ ] Per-context oRPC contracts (`ingestion`, `wiki`, `chat`, `verification`) defined in `packages/contracts/src/<context>/`
- [ ] Shared types as Zod schemas at the seam: `Span`, `Citation`, `Claim`, `WikiSchema`, `PageType`, `Relation`, `Artifact`, `AnswerSegment`
- [ ] Domain event schemas: `SourceIngested`, `SchemaInferred`, `CompileFinished`, `AnswerProduced`, `CorrectionAccepted`
- [ ] Mock fixtures per procedure (deterministic happy-path data) so the web app and per-context tests can run before implementations exist
- [ ] Generated TypeScript clients consumed by `apps/web`
- [ ] `bun run check` passes
**Depends on:** —

### Phase 1 — three parallel tracks (use `superpowers:dispatching-parallel-agents`)

#### Slice 1.A — Risk spike (throwaway)

**Why:** Validate Drive ingest latency + per-doc compile cost before sinking real work into a path that doesn't fly.
**Done when:**
- [ ] Drive auth happy path with my dev Google account
- [ ] 5 PDFs from a Drive folder ingested + quick SchemaInfer → typed ConceptPages
- [ ] Measured: per-doc latency, tokens, USD cost, span-citation accuracy
- [ ] Risk report appended to `folder-wiki/spec.md` §5 with go/no-go on chosen models
**Depends on:** Slice 0.1

#### Slice 1.B — DDD scaffolding

**Why:** Per the linguistic-DDD discipline in `.claude/memories/domain-driven.md`, glossaries land before code. Promotes the four context drafts into real packages.
**Done when:**
- [ ] `packages/domains/{ingestion,wiki,chat,verification}/` created with `package.json`, `tsconfig.json`, `glossary.md`, `.cspell/glossary.txt`, `src/{domain,application,infrastructure,interface}/`
- [ ] Glossary content from drafts moved into each context's `glossary.md` (with third-leap additions: `WikiSchema`, `PageType`, `Relation`, `IndexPage`, `Artifact`)
- [ ] `cspell.json` updated with four new dictionary definitions and four overrides
- [ ] `docs/ubiquitous-language.md` context map updated with four new rows
- [ ] `docs/projects/folder-wiki/contexts/` removed (drafts retired into canonical location)
- [ ] `bun run check` passes
**Depends on:** Slice 0.1

#### Slice 1.C — UI bootstrap

**Why:** Web UI must be buildable against contract mocks in parallel with Phase 2 backends. Bootstrap the design system before any component lands.
**Done when:**
- [ ] `shadcn/ui` initialized; Tailwind config with project tokens (colors, typography, spacing, motion per spec §4.2)
- [ ] Storybook (or `/design-system` route) up
- [ ] Component skeletons rendered against contract mocks: `WikiPage` magazine layout, `CompileTheater` lanes, `CitationChip` + flight, `LintRibbon`, `ArtifactRegistry` shell, `SpanShimmer`
- [ ] Empty / loading / error states named and rendered for each surface
**Depends on:** Slice 0.1

### Phase 2 — five parallel implementation tracks (use `superpowers:subagent-driven-development`)

#### Slice 2.A — ingestion

**Why:** Everything downstream needs Sources.
**Done when:**
- [ ] `GoogleDriveConnector` (production)
- [ ] `Source` aggregate + `Manifest` + `Span` + `Outline` value objects
- [ ] `extractSource` use-case for PDF, Doc, Sheet, Slide → text + outline + page images
- [ ] R2 layout per spec §3.2; D1 schema for `sources`, `folders`, `oauth_tokens`
- [ ] Procedures: `connectDrive`, `listFolders`, `ingestFolder`, `streamIngestEvents`
- [ ] Tests: `Span` content-hash invariants, OAuth refresh, ingest idempotency
**Depends on:** Slices 0.1, 1.B

#### Slice 2.B — wiki (with adaptive schema)

**Why:** The core LLM-Wiki pattern + the third leap (adaptive schema).
**Done when:**
- [ ] `SchemaInferrer` agent (Sonnet 4.6) reads first 5–10 Sources, emits `WikiSchema`
- [ ] Compile pipeline: `Planner` → `Researcher`s → `Drafter` → `Linker` → `IndexBuilder`
- [ ] Aggregates / value objects: `Wiki`, `WikiPage` (subtypes: Concept / Summary / Answer / **Index**), `WikiSchema`, `PageType`, `Relation`, `Backlink`, `Citation`, `Claim`, `CompileRun`, `CompileEvent`
- [ ] `CompileRunDO` orchestrates the multi-minute compile + SSE fan-out
- [ ] D1 schema for `wikis`, `wiki_pages`, `backlinks`, `claims`, `citations`, `compile_runs`
- [ ] Procedures: `compileFolder`, `streamCompileEvents`, `getWiki`, `getSchema`, `getWikiPage`
- [ ] Subscribes to `SourceIngested` (incremental compile wired but not driven in v1)
- [ ] Tests: golden-file deterministic-enough wiki structure on a 5-doc fixture; one IndexPage per PageType
**Depends on:** Slices 0.1, 1.B

#### Slice 2.C — chat (with Generative artifact answers)

**Why:** Demo Moment 2 + the second leap (artifact answers).
**Done when:**
- [ ] Aggregates / value objects: `Conversation`, `Turn`, `Question`, `Answer`, `AnswerSegment` (prose / citation / **artifact**), `CitationChip`
- [ ] `Researcher` + `Synthesizer` agents (Haiku 4.5 / Sonnet 4.6 per spec §2.4)
- [ ] **Closed Artifact component registry**: `ComparisonTable | Timeline | LineChart | BarChart | KeyMetric | CodeBlock | Quote | Markdown`
- [ ] Synthesizer's structured-output schema enforces the registry
- [ ] `ConversationDO` with WebSocket for `AnswerSegment` streaming
- [ ] D1 schema for `conversations`, `turns`
- [ ] Procedures: `openConversation`, `ask`, `streamAnswer`, `list`
- [ ] Tests: hard cross-doc question against fixture wiki returns ≥1 Artifact + ≥3 Citations; hash check on every emitted `Citation.span` (no fabrication)
**Depends on:** Slices 0.1, 1.B

#### Slice 2.D — verification (lint loop)

**Why:** Demo Moment 3 + the primary leap (reliability).
**Done when:**
- [ ] Aggregates / value objects: `LintRun`, `LintFinding`, `Verdict` (`supported|unsupported|contradicted`), `Correction`
- [ ] `Verifier` agent (**Opus 4.7** — different family from Sonnet)
- [ ] `lintWiki` use-case: extract Claims → fetch cited Spans → issue Verdicts → propose Corrections
- [ ] `LintRunDO` orchestrates concurrent per-Claim verification (cap 6 parallel)
- [ ] D1 schema for `lint_runs`, `lint_findings`
- [ ] Procedures: `lintWiki`, `streamLintEvents`, `applyCorrection`
- [ ] Subscribes to `CompileFinished` for auto-trigger; daily Cron Trigger for sampling pass
- [ ] Determinism check: planted contradiction in fixture caught on ≥10/10 runs
**Depends on:** Slices 0.1, 1.B

#### Slice 2.E — web UI implementation against mocks

**Why:** Phase-2 parallelism payoff. UI fully polished against contract mocks before backend lands.
**Done when:**
- [ ] All six spectacular elements (spec §4.3) implemented and animated
- [ ] Routes: `/` (folder picker), `/wiki/:wikiId` (browse), `/wiki/:wikiId/page/:pageId` (read), `/chat/:conversationId` (chat)
- [ ] Empty / loading / error states for every surface, screenshot-grade
- [ ] Visual diff snapshot tests pass on the design system stories
- [ ] Demo flow runs end-to-end against contract mocks with full polish
**Depends on:** Slices 0.1, 1.C

### Phase 3 — integration + curation

#### Slice 3.1 — Mock-swap + end-to-end testing

**Why:** Test of contract quality. The "<5 min to integrate" promise from §1 is verified here.
**Done when:**
- [ ] Contract mocks replaced with real implementations across `apps/web`
- [ ] End-to-end against a real Drive folder works
- [ ] Citation flight against real PDF.js sources works
- [ ] Lint catches the planted contradiction deterministically (≥10/10)
- [ ] Latency feels responsive (target < 60s compile end-to-end; ≤ 2s first chat token)
**Depends on:** Phase 2 complete

#### Slice 3.2 — Demo curation

**Why:** The demo folder is the test fixture for the video.
**Done when:**
- [ ] ~20 board-governance docs in a curated Drive folder
- [ ] One subtle planted contradiction (deterministic catch by lint)
- [ ] Compile cadence tuned (parallel Researcher fan-out, KV cache warmups)
- [ ] Cold-open phrasing rehearsed (no script per the brief)
**Depends on:** Slice 3.1

### Phase 4 — deploy + record + submit

#### Slice 4.1 — Deploy

**Done when:**
- [ ] `apps/api` deployed to Cloudflare Workers (`wrangler deploy`)
- [ ] `apps/web` deployed (per `0001` Slice 5 ADR)
- [ ] Production secrets via Infisical → `wrangler secret bulk`
- [ ] Custom domain or `workers.dev` URL confirmed accessible
**Depends on:** Phase 3 complete, Q5 resolved

#### Slice 4.2 — Record

**Done when:**
- [ ] Backup recordings of Moments 1, 2, 3 captured separately
- [ ] 10–20 min main video covering brief sections (product demo ≤ half, tech stack, architectural decisions, trade-offs)
- [ ] Uploaded to YouTube as unlisted
**Depends on:** Slice 4.1

#### Slice 4.3 — Submit

**Done when:**
- [ ] Public GitHub repo with README pitch deck (run/test instructions, deployed link, video link)
- [ ] Deployed link confirmed accessible
- [ ] Submission completed via Ashby
**Depends on:** Slice 4.2

## Dependencies

External:
- Tenex take-home Ashby submission link
- GSuite OAuth client (Drive read scope) — Drive scope verification turnaround is the main wildcard
- Cloudflare account with `wrangler login`
- A YouTube account for unlisted upload

Internal:
- `0001-finish-scaffolding` Slice 1 (CI green) before any feature work merges
- `0001-finish-scaffolding` Slice 5 (web deploy ADR) before Slice 9 deploys

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Drive ingest latency at folder scale blows the demo's "feels responsive" bar | Medium | Slice 2 spike measures; if too slow, parallelize Connector fetches and pre-warm cache before recording |
| Lint loop is non-deterministic on the planted contradiction | Medium | Pin Verifier model + temperature; require ≥10/10 catches in dry-run before recording; backup recording covers the worst case |
| Compile cost per doc explodes at 20 docs and breaks the budget | Low–Medium | Haiku for the high-volume passes (per-doc Summary); Sonnet only for Concept synthesis and Verification; cap retries |
| GSuite Drive scope verification stalls and OAuth gates the demo | Low | Use my own developer account for the demo; user-tier consent screen is fine for one tester |
| Live demo failures during recording | Low | Backup recordings of all three Moments; rehearse cold-open phrasing once |
| Span-anchored citations slip when source bytes shift | Low | Span identity is content-hash–rooted (per ingestion glossary); verified by Slice 4 invariant test |
| Cloudflare Workers DO connection limits at peak chat concurrency | Low | Take-home demo is single-user; not a real risk; called out for the trade-offs section of the video |
| The "way above and beyond" framing tips into "didn't actually deliver the prompt" | Medium | Re-read the brief at end of every slice; the wiki + chat + citations IS the brief, the lint loop IS the leap, no further leaps |

## Notes

The 13 slices are organized contract-first for maximum parallelism. Phase 0 is gating; everything inside a phase runs in parallel.

**Parallelism toolchain:**
- Phase 1 fan-out: `superpowers:dispatching-parallel-agents` (3 concurrent agents on disjoint scopes)
- Phase 2 fan-out: `superpowers:subagent-driven-development` (5 concurrent slice-implementer agents)
- Phase 3 / 4: sequential, but Phase 3.1 mock-swap should feel near-instant if Phase 0 contracts were tight

**Per-slice review:** `pr-review-toolkit:review-pr` on every slice PR; `pr-review-toolkit:silent-failure-hunter` and `pr-review-toolkit:type-design-analyzer` on contract-touching slices (0.1, 1.B, 2.A–2.D).

**Per-context glossary discipline:** Phase 1.B updates `cspell.json` with `addWords:false` per context; any new term in Phase 2 requires editing the glossary in the same PR — agents are briefed with this rule.

**Time framing.** Per project memory `feedback-time-framing.md`: do not size in weeks/days. Ambition over hours; the 13 slices fit the day's wallclock when run with the recommended parallelism.

**Forcing function.** Every architectural decision is graded by whether it makes one of the three Demo Moments more convincing as a client pitch (per `take-home-direction.md` memory). If a slice's "Done when" doesn't connect to a Moment, demote it.

## Phase 8 surface — outstanding work after Phase 5 chat smoke test

Surfaced by the user while smoke-testing chat against a freshly compiled wiki. Phase 5 chat ships, but the wiki was being treated as a search target instead of as the typed table-of-contents over the source corpus. These items move the product from "usable end-to-end" to "feels like a real wiki product" — they all serve Demo Moment 2 (cross-doc Q&A with span-jumping citations).

1. **Wiki-as-typed-guide, not search-target.** The wiki is a typed ToC over a corpus of source PDFs/text. Chat must use the wiki to TRAVERSE to underlying source slices — not just BM25 the wiki page bodies. Findings handed to the synthesizer must include the actual source-slice text, cited via wiki Citations (so the verifier still has a span to check). Code paths: `apps/api/src/build-chat-context.ts`, `packages/domains/chat/src/application/research-question.ts`, `packages/domains/chat/src/application/synthesize-answer.ts`.

2. **Agentic chat search loop.** The chat synth should "really try hard" — not give up after one BM25 round. Expose tools to the LLM so it can iteratively explore: `searchWiki(query)`, `expandQuery(question)`, `getPage(id)`, `readSourceSlice(citationId)`. Loop until enough findings are collected or a budget cap is hit. Today's single-pass BM25 + suggestion fallback is the floor, not the ceiling.

3. **IndexPages = traversal aids.** Each IndexPage should have a body: PageType description + per-entry teaser using the first claim text from each ConceptPage. They're a real wiki ToC for that PageType, not a flat link list. Wire into the wiki compile path (`@domain/wiki` IndexBuilder).

4. **Wiki overview UI = file-structure.** `/wiki/:id` should look like a real wiki: left sidebar with hierarchical tree (PageType → IndexPage → ConceptPages), main pane shows the overview / selected page. Not a flat grid. Code paths: `apps/web/src/routes/` wiki routes.

5. **Delete-wiki capability.** Required so users can re-compile against the same folder — `UNIQUE(wikis.folder_id)` blocks otherwise and users get stuck on a stale compile. Add a delete action in the wiki UI; cascade through `wiki_pages`, `claims`, `citations`, `compile_runs`.

6. **Citation slice-hash invariant.** `Citation.span.contentHash` MUST be `sha256(source.text.slice(start, end))` (the byte-range slice), NOT the source's whole-file hash. The chat `SourceHashVerifier` enforces this. Both compile + seed paths (`apps/api/src/seed-wiki.ts`) must compute it correctly. Already partially fixed in the post-Phase-5 chat smoke pass; keep as a forward-going invariant — any new path that mints citations must hash the slice, not the file.

Self-contained brief and code paths in `wiki-product-priorities.md` (project memory).
