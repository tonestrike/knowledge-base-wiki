# folder-wiki — cross-context map (draft)

Cross-context glossary and context map for the four bounded contexts in
this project. Supplements `docs/ubiquitous-language.md` (the repo-wide
map). Each context's own draft glossary remains the source of truth for
its terms.

## Contexts

| Context | Owns | Aggregate root |
|---|---|---|
| ingestion | Sources, Spans, Manifests, Extractions, Outlines, Connectors | Source |
| wiki | WikiPages, Backlinks, Citations, Claims, CompileRuns | Wiki |
| chat | Conversations, Turns, Questions, Answers, AnswerSegments | Conversation |
| verification | LintRuns, LintFindings, Verdicts, Corrections | LintRun |

## Shared types (live at the contracts seam)

| Type | Shape | Owned by | Used by |
|---|---|---|---|
| Span | `(source_id, byte_range, content_hash)` | ingestion | wiki, verification |
| Citation | `(span, label)` | wiki | chat (read), verification (audits) |
| Claim | A verifiable assertion in a WikiPage | wiki | verification (audits) |

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
| CompileFinished | wiki | verification | Triggers an automatic LintRun |
| AnswerProduced | chat | wiki | May file as AnswerPage if user opts in |
| CorrectionAccepted | verification | wiki | Applies the Correction to the WikiPage |

Events flow through `@package/shared-kernel`'s event bus pattern. No context
imports another context's domain code directly.

## Why these contexts are separate (not one big "knowledge" context)

- **Different aggregate invariants.** Sources are immutable; WikiPages are mutable; LintRuns are append-only; Conversations are user-scoped.
- **Different change cadences.** Ingestion runs on Drive sync; Compile runs after ingest; Verification runs on schedule or after Compile; Chat runs per user request.
- **Different language.** Each context has terms its peers don't share — Source/Span/Outline live in ingestion only; Verdict/Correction live in verification only.
- **Linguistic test.** "Page" only makes sense if you already know which context you're in. The fact that disambiguation is necessary is a sign the contexts are real.

## Open questions (resolve in Move 3 — architecture blueprint)

- **Where do `Span` and `Citation` value objects physically live?** Likely as Zod schemas in `@package/contracts` referenced by all four context contracts. Confirm with architect.
- **Is `chat` truly a separate package?** Strong arguments either way. Litmus test: do `Conversation`/`Turn` aggregates need their own persistence? Probably yes (chat history is durable), so yes — separate package.
- **Does `verification` need its own LLM model selection?** Should use a *different* model than the Compiler to avoid self-grading bias. Pin model selection per-context, not globally.
- **Are `AnswerPage`s a wiki subtype or a separate aggregate?** Currently modeled as a WikiPage subtype. Reconsider if they have meaningfully different invariants (e.g., immutability after creation).
