# 0002 — folder-wiki

**Status:** Active
**Started:** 2026-05-09
**Done:** —
**Owner:** tonyvantur
**Related:** [storyboard](folder-wiki/storyboard.md), [bounded contexts](folder-wiki/contexts/), [0001-finish-scaffolding](0001-finish-scaffolding.md), Tenex FDE take-home brief

## Goal

Submit the Tenex Forward Deployed Engineer take-home: a deployed *Compile a Folder into an LLM Wiki* product, a public GitHub repo with a clear `README.md`, and a 10–20 min unlisted YouTube video — implementing Andrej Karpathy's LLM-Wiki pattern (April 2026) with a span-verifying lint loop that addresses the pattern's known hallucination critique.

## Why now

The take-home is the gate for FDE candidacy. Karpathy's LLM-Wiki gist is one month old; the trajectory-awareness it demonstrates is freshest right now. The submission brief explicitly grades "understanding of LLMs and their trajectory" — implementing this specific pattern, plus addressing its publicly-known weakness in production, is the most-direct demonstration available. The Better-Perplexity prompt was the runner-up; rejected because folder-wiki rewards taste over spectacle, which lands harder for an engineering hire.

Concrete trigger: assignment is in flight; submission link is waiting.

## Out of scope

- **OpenAI Realtime / voice mode.** Tempting, but the lint loop is the reliability differentiator and voice doesn't make the demo more convincing.
- **Graph view of backlinks.** Obsidian-style; nice-to-have. Cut unless it earns its place in a demo moment.
- **Multi-folder workspaces and cross-folder linking.** Single Folder per Wiki for v1.
- **Auto-update when the Drive folder changes** (Drive webhooks + incremental compile). Manual re-compile is fine for demo.
- **Vector embeddings as the retrieval substrate.** The wiki *is* the index — agentic search reads it directly. We acknowledge the scaling ceiling (~100 docs in context) in the trade-offs section of the video, but don't build a hybrid for v1.
- **Multi-tenant isolation, per-org workspaces, abuse rate limits.** Single-user OAuth is sufficient for the demo.
- **Generative-UI artifact protocol** (the Better-Perplexity vision). The wiki *is* the artifact in this project.

## Open questions

| # | Question | Who decides | By when |
|---|---|---|---|
| Q1 | Where do `Span` and `Citation` value objects physically live? Likely Zod schemas at the `@package/contracts` seam, re-exported by each context's contract. | architect blueprint (Slice 1) | Slice 1 |
| Q2 | Is `chat` its own package, or a thin context-aware orchestration layer over `wiki`? Litmus: do `Conversation`/`Turn` aggregates need durable persistence (probably yes). | architect blueprint (Slice 1) | Slice 1 |
| Q3 | Are `AnswerPage`s a `WikiPage` subtype or a separate aggregate? Currently modeled as a subtype; revisit if invariants meaningfully diverge. | architect blueprint (Slice 1) | Slice 1 |
| Q4 | Verifier model selection: must differ from Compiler model to avoid self-grading bias. Which model? | architect blueprint (Slice 1) | Slice 1 |
| Q5 | Where does `apps/web` deploy for the live link? Inherits from `0001` Slice 5 (web deploy ADR). | tonyvantur | before Slice 9 |
| Q6 | Drive auth: single-user OAuth (sufficient for demo) vs per-user. Default single-user; revisit only if it costs us a demo moment. | tonyvantur | Slice 4 |
| Q7 | Does compile latency at ~20 docs feel responsive (< 60s end-to-end)? Risk-spike result drives a model-selection retread if not. | Slice 2 result | Slice 2 |

## Slices

### Slice 1 — Architecture blueprint

**Why:** Move 3 of the planning sequence. Resolves Q1–Q4, locks the agent topology, the storage layer (D1 / R2 / KV / Durable Objects), the streaming protocol (SSE for compile events, WebSocket via Durable Object for chat), and the per-context oRPC contract surface. Briefed by the storyboard + bounded-context drafts; produced by `feature-dev:code-architect`; **read and decided by us, not handed off to "go build it."**
**Done when:**
- [ ] `docs/projects/folder-wiki/architecture.md` exists, covering: agent topology (planner / researcher / drafter / linker / synthesizer / verifier — what each does, what tools each gets, what model), storage layer (D1 schema sketch, R2 layout, KV usage, DO usage), streaming protocol per procedure, per-context oRPC contract surface (procedure shapes, not full schemas), citation rendering pipeline (Span → PDF.js highlight), lint-loop trigger and cadence, and recommended slice plan
- [ ] Q1–Q4 resolved with rationale
- [ ] Diagrams (mermaid) for the agent topology and the data flow
- [ ] Risks called out specific to the architecture (e.g., DO connection limits at peak chat concurrency)
**Depends on:** —
**Estimate:** M

### Slice 2 — Risk spike: 5-PDF compile (throwaway)

**Why:** Validates the two technical risks (Drive ingest latency at folder-scale; per-doc compile cost) before we sink real architecture work into a path that doesn't fly. Throwaway code; the only output we keep is a one-page risk report appended to `architecture.md`.
**Done when:**
- [ ] 5 real PDFs from a Drive folder ingested via the GoogleDriveConnector spike
- [ ] Each PDF compiled into one ConceptPage and one SummaryPage with at least one Citation each
- [ ] Localhost render of the wiki tree
- [ ] Measured: per-doc compile latency, total tokens, USD cost
- [ ] Risk report appended to `architecture.md` with go/no-go on the chosen models
**Depends on:** Slice 1 (model selection from architecture)
**Estimate:** S — assuming no surprises. M if Drive scopes need verification or compile is dramatically slower than projected.

### Slice 3 — Bounded context scaffolding

**Why:** Promote the four bounded-context drafts from `docs/projects/folder-wiki/contexts/` into real packages with the project's standard layout. Per the linguistic-DDD discipline in `.claude/memories/domain-driven.md`, glossaries land before code.
**Done when:**
- [ ] `packages/domains/{ingestion,wiki,chat,verification}/` created, each with `package.json`, `tsconfig.json`, `glossary.md`, `.cspell/glossary.txt`, `src/{domain,application,infrastructure,interface}/`
- [ ] Glossary content from the drafts is moved into each context's `glossary.md`; cspell wordlists into `.cspell/glossary.txt`
- [ ] `cspell.json` updated with four new `dictionaryDefinitions` and four `overrides` (one per context path)
- [ ] `docs/ubiquitous-language.md` context map updated with the four new rows + cross-references
- [ ] `docs/projects/folder-wiki/contexts/` removed (drafts retired into the canonical location)
- [ ] `bun run check` passes (lint + spell + typecheck + test)
**Depends on:** Slice 1
**Estimate:** S

### Slice 4 — ingestion: Drive auth + Source aggregate

**Why:** Everything downstream needs Sources to compile from. First real domain code; sets the pattern for the other contexts.
**Done when:**
- [ ] GSuite OAuth (single-user) wired; refresh-token persistence in D1
- [ ] `GoogleDriveConnector` (infrastructure) implements a connector port (domain)
- [ ] `Source` aggregate, `Manifest`, `Span` value object, `Outline` value object
- [ ] `extractSource` use-case handles PDF, Doc, Sheet, Slide → text + outline + page images
- [ ] R2 layout for source binaries; D1 schema for source metadata
- [ ] Procedures (oRPC): `ingestion.connectDrive`, `ingestion.listFolders`, `ingestion.ingestFolder`
- [ ] Tests: `Span` content-hash invariants, OAuth refresh, ingest-idempotency
**Depends on:** Slice 1, Slice 3
**Estimate:** L

### Slice 5 — wiki: Compile pipeline (no UI yet)

**Why:** The core LLM-Wiki pattern. Sources + planner → researchers → drafter → linker → Wiki. End-to-end functional; UI follows in Slice 6.
**Done when:**
- [ ] `Wiki`, `WikiPage` (Concept/Summary/Answer subtypes), `Backlink`, `Citation`, `Claim` aggregates and value objects
- [ ] `compileFolder` use-case orchestrates the agent topology defined in `architecture.md`
- [ ] `CompileEvent` stream emitted via SSE
- [ ] D1 schema for the wiki graph; KV for in-flight compile-run state
- [ ] Procedures: `wiki.compileFolder`, `wiki.getWiki`, `wiki.getWikiPage`, `wiki.streamCompileEvents`
- [ ] Cross-context: subscribes to ingestion's `SourceIngested` event for incremental compile triggers (out of scope for v1 — record the wiring, don't drive it)
- [ ] Tests: golden-file test on a fixed 5-doc fixture asserting the wiki structure is deterministic enough
**Depends on:** Slice 4
**Estimate:** L

### Slice 6 — wiki UI: browse, cite, live trace

**Why:** Demo Moment 1 (live compile) and Moment 2 (cross-doc Q&A with span-jumping citations) hinge on this UI. Without it, the demo is a JSON dump.
**Done when:**
- [ ] Web app page tree shows ConceptPages and SummaryPages with backlinks
- [ ] Citation chips rendered inline on every Claim
- [ ] PDF.js viewer modal opens to the right page with the cited Span highlighted
- [ ] Live compile trace pane renders `CompileEvent`s in real time
- [ ] Loading and empty states are not embarrassing
- [ ] Visual polish bar: matches the design quality the FDE evaluator is looking for. **No half-built UI ships in the demo.**
**Depends on:** Slice 5
**Estimate:** L

### Slice 7 — chat: Q&A over the Wiki

**Why:** Demo Moment 2. Researcher reads the wiki, Synthesizer composes Answer with span-anchored Citations, AnswerSegments stream into the UI.
**Done when:**
- [ ] `Conversation`, `Turn`, `Question`, `Answer`, `AnswerSegment`, `CitationChip` aggregates and value objects
- [ ] Durable Object per Conversation for streaming state
- [ ] Researcher + Synthesizer agents (model picks per architecture)
- [ ] Procedures: `chat.openConversation`, `chat.ask` (returns DO WebSocket URL), `chat.list`
- [ ] UI: chat pane right of the wiki; AnswerSegments stream in order; Citation chips clickable; follow-ups work
- [ ] Tests: golden-file Q&A against the fixture wiki; agent doesn't fabricate citations (asserted by hash check on every emitted `Citation.span`)
**Depends on:** Slice 5
**Estimate:** L

### Slice 8 — verification: lint loop

**Why:** Demo Moment 3 — the reliability story. Without this, we're indistinguishable from any other RAG demo.
**Done when:**
- [ ] `LintRun`, `LintFinding`, `Verdict` (`supported|unsupported|contradicted`), `Correction` aggregates and value objects
- [ ] `Verifier` agent (model differs from Compiler per Q4)
- [ ] `lintWiki` use-case: extract Claims → fetch cited Spans → issue Verdicts → propose Corrections
- [ ] Procedures: `verification.lintWiki`, `verification.streamLintEvents`, `verification.applyCorrection`
- [ ] UI: per-page lint badge; per-Claim flag overlay with the cited Span next to the Claim text; "Apply correction" button
- [ ] Trigger: subscribes to wiki's `CompileFinished` event for automatic post-compile lint; manual trigger also works
- [ ] Determinism check: planted contradiction in the demo fixture is caught on ≥10/10 runs
**Depends on:** Slice 5

**Estimate:** L

### Slice 9 — Demo curation, polish, deploy

**Why:** The video is the deliverable. Everything before this is in service of three minutes of screen time per moment.
**Done when:**
- [ ] Demo folder curated: ~20 docs (PDF / Doc / Sheet / slide deck mix), with one **planted contradiction** subtle enough to look real but deterministic enough that the lint catches it
- [ ] Compile of the demo folder feels responsive (target < 60s; informed by Slice 2 spike)
- [ ] Chat answer streams within 2s of asking on the demo questions
- [ ] PDF.js span-highlight tested end-to-end on every demo citation
- [ ] Public `README.md` covers: what it is, how to run locally, how to test, deployed link, video link
- [ ] Deployed: `apps/api` to Cloudflare Workers, `apps/web` to whatever target Q5 lands on
- [ ] Production-safe: secrets via Infisical → wrangler; no `.dev.vars` committed
**Depends on:** Slices 4–8, Q5 resolved
**Estimate:** M

### Slice 10 — Record + submit

**Why:** The actual deliverable.
**Done when:**
- [ ] Backup recording of Moments 1, 2, 3 captured separately (in case live demo fails on the day)
- [ ] Cold-open phrasing rehearsed (no script; brief explicitly says "be yourself")
- [ ] 10–20 min video recorded, covering: product demo (≤ half), tech stack, architectural decisions, technical trade-offs (per the brief's required structure)
- [ ] Uploaded to YouTube as **unlisted**
- [ ] Public GitHub repo URL confirmed accessible
- [ ] Deployed live link confirmed accessible
- [ ] Submission completed via Ashby link
**Depends on:** Slice 9
**Estimate:** S — assuming Slice 9 left no fires.

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

Suggested order, given dependencies:

1. **Slice 1** — Architecture blueprint (briefs `feature-dev:code-architect`; we synthesize)
2. **Slice 2** — Risk spike (throwaway; in parallel with reading Slice 1 output)
3. **Slice 3** — Bounded context scaffolding (mechanical; clears `bun run check` quickly)
4. **Slice 4** — ingestion (foundational; everything else needs Sources)
5. **Slice 5** — wiki compile pipeline (the core)
6. **Slice 6** — wiki UI (Demo Moments 1 + 2 enabled)
7. **Slice 7** — chat (Demo Moment 2 fully enabled)
8. **Slice 8** — verification (Demo Moment 3 enabled)
9. **Slice 9** — Demo curation + deploy
10. **Slice 10** — Record + submit

Total estimate: ~7–10 days of focused work. Each slice is its own PR. Slices 6, 7, 8 each contain real frontend work and may want pairing with `pr-review-toolkit:code-reviewer` and `feature-dev:code-explorer` for surface area.

The video is the deliverable. Every architectural decision is graded by whether it makes one of the three Demo Moments more convincing on screen. If a slice's "Done when" doesn't connect to a Moment, demote it.
