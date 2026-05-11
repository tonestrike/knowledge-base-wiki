# Ship plan

A working roadmap for what's shipped, what's in flight, and what the architecture is set up to absorb next. Read this if you're trying to understand the current trajectory of the project without scrolling git log.

This is intentionally a living document — every item that ships moves from one section to another, every item we decide against moves to "Considered and cut" with the reason.

## Shipped

- **Session-scoped Drive auth** (signed cookie via SHA-256 keyed hash, `apps/api/src/session.ts`) — replaces the hardcoded `DEMO_USER_ID`. Anonymous callers can still read the featured wiki; everything else is gated.
- **Public-by-design homepage** (`apps/web/src/routes/root.tsx`) — first-time visitors land on the seeded Anthropic-research wiki hero, no sign-in friction. The dev OAuth client is unverified, so this is the right product for the demo.
- **Featured wiki anon-filter** (`apps/api/src/index.ts:keepOnlyFeaturedWiki`) — anonymous `wiki.listWikis` returns only the featured id; other users' wikis stay private.
- **OTel observability with Langfuse-ready OTLP exporter** (`packages/shared-kernel/src/observability/`) — every LLM call and top-level use-case (`compile.run`, `compile.synthesis.page`, `chat.turn`, `chat.tool.*`, `lint.run`, `llm.call`) emits spans following OTel GenAI semantic conventions. Switching to Langfuse is three env vars; no code change.
- **`llm.call` span lifecycle factored** (`packages/shared-kernel/src/observability/llm-call.ts`) — four LLM adapters previously hand-rolled the same span open/usage/close block. Now they share `startLlmCallSpan(tracer, start)`.
- **Citation-roundtrip eval** (`evals/citation-roundtrip.ts`) — proves every citation's `contentHash` matches the live source bytes against the deployed api. Currently 57/57 pass on the featured wiki.
- **Playwright E2E** (`e2e/`) — public-path smoke + anonymous-only regression. Runs against the live deploy on push-to-main + `workflow_dispatch`; deliberately skipped on PRs (the live URL lags PR code).
- **Composition-root cleanup** (`apps/api/src/index.ts`) — typed `c.var.userId` via Hono `Variables` (no `as never` casts), named `buildFlatContext` helper, `keepOnlyFeaturedWiki` extracted with JSDoc, dependency-injected `mountIngestionAuthCallback` + `mountSourceArtifacts` + `mountDevRoutes`.
- **Cloudflare type stubs consolidated** (`packages/shared-kernel/src/cf-types.ts`) — domain packages no longer duplicate `D1Database` / `R2Bucket` / etc.
- **README architecture diagram, screenshots, evals section, design tradeoffs** — top of repo now lands the reviewer.
- **`docs/architecture/`** — deep walkthroughs: `talk.md` (screen-share narrative), `code-tour.md` (file-by-file), `perspective-flow.md` (single thread end-to-end), plus ADRs and ubiquitous-language glossary.

## In flight

Six background streams launched in parallel; each is in its own worktree with a focused diff. PRs land independently.

| Stream | Owns (exclusive files) | What it ships |
|---|---|---|
| **K — `BUGS_AND_FIXES.md`** | `docs/BUGS_AND_FIXES.md` | 10-14 real bugs from git log, each with symptom / root cause / fix diff / lesson |
| **L — Faithfulness eval** | `evals/faithfulness.ts`, `evals/faithfulness-cases.ts` | 10-12 questions scored by Opus 4.7 judge on faithfulness / correctness / citationQuality / hallucination |
| **M — Failure-mode classifier** | `evals/classify-failure.ts`, `evals/run-with-classifier.ts` | 5 classes (`INGESTION_MISS`, `COMPILE_MISS`, `RETRIEVAL_MISS`, `SYNTHESIS_FAIL`, `VERIFIER_FALSE_NEGATIVE`) — diagnoses why each case fails |
| **N — DOCX + Markdown extractors** | `packages/domains/ingestion/src/infrastructure/{docx,markdown}-extractor.ts` | mammoth-based DOCX adapter + plain Markdown adapter, wired into `buildIngestionContext` |
| **O — Vectorize fallback** | `packages/domains/chat/src/infrastructure/{vector-wiki-reader,openai-embeddings-client}.ts` + wrangler binding | Cloudflare Vectorize + OpenAI `text-embedding-3-small` for `searchSources` only; falls back to D1 token-overlap on miss or missing binding |

Each agent commits its own branch, opens its own PR, runs `bun run check` green before pushing. Look for PRs prefixed `[Stream <K\|L\|M\|N\|O>]` on the repo.

## Polish backlog (architecture is set up for these)

Ordered by ROI per effort.

### Tier A — large lifts that strengthen the load-bearing bets

1. **Per-source LLM summary at compile time, used for broad-summary queries.** Extends the existing Narrator pass (`packages/domains/wiki/src/application/narrator-pass.ts`) to also produce one paragraph per source doc. The chat agent gets a new tool `getSourceSummary(sourceId)` it can call before deciding whether to drill down. Materially improves "what's in this folder" answers, which are currently the weakest demo path. Effort M. ROI high.
2. **Drive-delta probe in evals.** Catches Drive-extractor regressions: re-fetch a Drive doc, recompile, assert the wiki's claim set is unchanged. Without this, an upstream Drive API change can silently break ingestion. Effort M. ROI medium-high.
3. **Wiki page embeddings (full semantic search, not just sources).** Stream O ships source-level fallback; the wiki-page layer still uses token-overlap. Full pipeline would embed every wiki page at compile time, query Vectorize with both sources and pages in the search loop. Larger redesign — leave until source-level fallback proves its value. Effort L. ROI high but compounds with #1.
4. **Query rewriter for chat follow-ups.** The agentic researcher currently sees only the bare question; pronoun-heavy follow-ups ("what about the next one") retrieve garbage. Add a `rewriteQuery(history, currentQuestion)` step before the first tool call. Has a CRITICAL-RULE constraint: preserve user-explicit identifiers (numbers, names) unchanged. Effort S. ROI high.
5. **Chat-time citation hash verification tool.** Hash-pinning is already a load-bearing differentiator at compile time. Lifting it into the agent loop — a `verifyCitation` tool the model must call before final answer — turns "we audit every claim once" into "every cited byte range is re-hashed on every answer." Effort M. ROI high.

### Tier B — UX polish

6. **Text-selection → ask chat with page-pinning.** Select text in a wiki page, get a popover with "Ask chat about this." Pins the agent's first tool call (`readWikiPage` or `searchWiki`) to that page. Effort M. ROI medium-high.
7. **Inline source-preview on citation hover.** Hovering a citation chip already shows the source name + label; extend to also fetch the byte slice from `/__source/<id>/text` and render the actual prose in the tooltip. The Verifier already proves the hash matches; let the reader see the bytes without leaving the page. Effort S. ROI medium.
8. **Compile-cost + latency dashboard** at `/admin/observability` reading aggregated spans from KV. Our OTel data has the numbers; nobody seeing the README knows that. Effort M-L. ROI medium.
9. **Inline per-answer cost + latency line.** Every chat answer renders one small grey line under the last citation: `~$0.0021 · 4.3s · 3 sources`. Sourced from the existing `llm.call` spans. Makes the operational maturity visible without anyone opening a dashboard. Effort S. ROI easy win.

### Tier C — narrative + meta

10. **Demo video** (2-min Loom): compile theater → wiki overview → lint dashboard → chat with citations. The Drive OAuth client is unverified, so any reviewer wanting to demo with their own folder needs dev setup; a video sidesteps that. Effort S. ROI medium.
11. **Citation-roundtrip on every push to main** as a CI gate. Currently runs locally / manually. Promote to a GitHub Action that POSTs a comment if any hash drifts. Effort S. ROI medium.
12. **`docs/talk.md` excerpt at top of README.** The walkthrough exists; the README links to it but doesn't preview it. A 200-line inline excerpt with the Mermaid diagram and one deep link raises the floor for visitors who don't click through. Effort S. ROI medium.

### Tier D — stretch goals

13. **OCR for scanned PDFs.** We currently drop the source on scanned PDFs. The fix is adding an OCR Extractor adapter (wasm-based or a Workers-friendly OCR API) — same shape as PDF/DOCX. Effort M. ROI medium (most folders aren't scans, but it expands the addressable folder universe).
14. **GraphRAG-style cross-page typed relations.** The wiki schema already has `relations`; chat doesn't yet traverse them. A `relatedPages(wikiPageId, relationType)` tool would let the agent walk the wiki graph instead of re-searching. Effort L. ROI medium — distinct bet, would extend the unique-thesis lead.
15. **Streaming compile theater as a first-class artifact.** Currently the compile shows progress live in the SPA; nothing persists. A `/compile/<runId>` deep link that plays back the compile narration on subsequent visits would make the unique-bet visible after the fact. Effort L. ROI medium.

## Considered and cut

- **Pivot to chat-over-chunks.** Decided no: the typed wiki IS the bet, and chat-over-chunks would discard the load-bearing differentiator. Retrieval-quality improvements underneath the `WikiReader` port (Tier A #1, #3, #4) are additive — same product, better recall on the worst queries.
- **OpenTelemetry SDK dependency** in the Worker. Considered when wiring the OTLP exporter. Decided no: the SDK bundle blows the Worker size budget and `crypto.subtle` + `fetch` are enough to speak OTLP/HTTP-JSON directly. The hand-rolled exporter in `packages/shared-kernel/src/observability/otlp-http-exporter.ts` is ~400 lines and zero deps.
- **Pure prompt-management plane** (Langfuse prompt versioning, A/B variants, evals dashboard). Considered alongside the OTel work. Decided no: shipping observability first answers "is the system behaving in prod?" today; prompt versioning answers "are prompts improving over weeks?" which is the wrong question for a take-home. The `LanguageModel` port is the seam those would plug into when the time comes.
- **Multi-tenant org accounts.** Considered alongside session-scoped auth. Decided no: the single-tenant demo is the right scope; multi-tenant lifts the featured-wiki id to per-org config, not a deeper refactor. Architecture is set up for it.

## How the architecture absorbs each backlog item

| Backlog item | Existing seam | New code |
|---|---|---|
| Per-source LLM summary (A1) | `narrator-pass.ts`, `WikiReader.searchSources` | one prompt + one D1 column + one tool |
| Drive-delta probe (A2) | `evals/citation-roundtrip.ts` as prior art | one new eval file |
| Wiki page embeddings (A3) | `vector-wiki-reader.ts` (Stream O ships the foundation) | extend `indexSource` to also index pages |
| Text-selection → ask (B4) | existing wiki-page route + chat dock | one popover component + one extra `targetPageId` field on `chat.open` |
| Citation-hover source preview (B5) | existing citation chip + `/__source/<id>/text` route | one popover, no new api |
| Observability dashboard (B6) | spans already emit; OTLP exporter is one of several outputs | aggregator + KV write-through + admin route |
| OCR (D10) | `Extractor` port; same shape as PDF/DOCX | one OCR adapter (wasm or API-backed) |
| GraphRAG (D11) | `WikiSchema.relations` already exists in the contract | one D1 join + one tool + one prompt |

If something on this list ever feels like a redesign rather than an additive extension, the architecture is wrong and the doc should be updated.

## Where to find things

- **Architecture overview:** `docs/architecture/overview.md` (start here)
- **Screen-share walkthrough:** `docs/architecture/talk.md`
- **File-by-file tour:** `docs/architecture/code-tour.md`
- **One thread end-to-end:** `docs/architecture/perspective-flow.md`
- **Bug log:** `docs/BUGS_AND_FIXES.md`
- **ADRs:** `docs/adr/`
- **Glossary (ubiquitous language across contexts):** `docs/ubiquitous-language.md`
- **Evals:** `evals/README.md`
