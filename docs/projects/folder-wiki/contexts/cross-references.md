# folder-wiki — cross-context map (draft)

Cross-context glossary and context map for the four bounded contexts in
this project. Supplements `docs/ubiquitous-language.md` (the repo-wide
map). Each context's own draft glossary remains the source of truth for
its terms.

Authoritative conceptual design: [`../spec.md`](../spec.md).

## Contexts

| Context | Owns | Aggregate root |
|---|---|---|
| ingestion | Sources, Spans, Manifests, Extractions, Outlines, Connectors | Source |
| wiki | WikiPages, **WikiSchemas, PageTypes, Relations, IndexPages**, Backlinks, Citations, Claims, CompileRuns | Wiki |
| chat | Conversations, Turns, Questions, Answers, AnswerSegments, **Artifacts**, CitationChips | Conversation |
| verification | LintRuns, LintFindings, Verdicts, Corrections | LintRun |

**Bold** terms are third-leap additions (adaptive wiki schema + generative artifact answers).

## Shared types (live at the contracts seam)

| Type | Shape | Owned by | Used by |
|---|---|---|---|
| Span | `(source_id, byte_range, content_hash)` | ingestion | wiki, verification |
| Citation | `(span, label)` | wiki | chat (read), verification (audits) |
| Claim | A verifiable assertion in a WikiPage | wiki | verification (audits) |
| WikiSchema | `(page_types[], relations[])` | wiki | UI (renders typed page templates) |
| Artifact | `(component_name, props, citations[])` | chat | UI (renders the chosen component) |
| AnswerSegment | discriminated union: prose / citation / artifact | chat | UI |

Implemented as Zod schemas in `@package/contracts`, re-exported by each context's contract module (resolves Q1 from `0002-folder-wiki.md`).

## Cross-references — same word, different meaning

| Word | ingestion | wiki | chat | verification |
|---|---|---|---|---|
| Page | PDF/Slide page (1-indexed integer) | WikiPage (markdown page) | — | — |
| Source | Raw fetched immutable record | Citation provenance reference | — | — |
| Compile | — | The operation producing a Wiki | — | — |
| Claim | — | A cited assertion in a WikiPage | — | The audit subject (same identity as wiki) |

To prevent ambiguity, longer disambiguated names (`WikiPage`, `CitedSource`)
are preferred in code that crosses the seam. Shorter names are valid only
inside their owning context.

## Domain events (cross-context coordination)

| Event | Emitted by | Consumed by | Purpose |
|---|---|---|---|
| SourceIngested | ingestion | wiki | Triggers compile of the new Source's SummaryPage |
| **SchemaInferred** | wiki (internal) | UI (informational) | Schema reveal in compile theater (Moment 1) |
| CompileFinished | wiki | verification | Triggers an automatic LintRun |
| AnswerProduced | chat | wiki | May file as AnswerPage if user opts in |
| CorrectionAccepted | verification | wiki | Applies the Correction to the WikiPage |

Events flow through `@package/shared-kernel`'s event bus pattern. No context
imports another context's domain code directly.

## Why these contexts are separate (not one big "knowledge" context)

- **Different aggregate invariants.** Sources are immutable; WikiPages are mutable; LintRuns are append-only; Conversations are user-scoped.
- **Different change cadences.** Ingestion runs on Drive sync; Compile runs after ingest; Verification runs on schedule or after Compile; Chat runs per user request.
- **Different language.** Each context has terms its peers don't share — Source/Span/Outline live in ingestion only; Verdict/Correction live in verification only; Artifact lives in chat only.
- **Linguistic test.** "Page" only makes sense if you already know which context you're in. The fact that disambiguation is necessary is a sign the contexts are real.

## Open questions resolved

Q1–Q4 from `0002-folder-wiki.md` resolved in [`../spec.md`](../spec.md) Appendix A:

- Q1: Span / Citation live as Zod schemas in `@package/contracts`, re-exported per context
- Q2: chat is its own package (Conversation has durable persistence)
- Q3: AnswerPage is a WikiPage subtype alongside Concept / Summary / **Index**
- Q4: Verifier on Opus 4.7 (different family from Sonnet to defeat self-grading bias)
