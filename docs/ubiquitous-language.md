# tenex — ubiquitous language

This is the cross-context glossary and context map. It does NOT replace per-context `glossary.md` files; those are the spec for each bounded context. This file is for terms that span the system AND for "see also" cross-references when two contexts use the same word differently.

## Cross-context terms

| Term | Definition | Notes |
|---|---|---|
| Context | A bounded subset of the model where a term has one specific meaning. Each `packages/domains/<x>/` is one context. | DDD term-of-art. |
| Procedure | A typed RPC operation defined in `@package/contracts`, implemented in a domain's `interface/`, consumed by `apps/web`. | Don't say "endpoint" or "API method". |
| Use-case | A pure function in a domain's `application/` that performs one business operation. Takes injected deps + input; returns a result. | Don't say "service" or "handler". |
| Procedure handler | Thin oRPC adapter in `interface/` that delegates to a use-case. Contains no logic. | The word "handler" is reserved for this. |
| Glossary | The per-context `glossary.md`. Source of truth for terms within that context. | Every term in code must be here. |

## Context map

| Context | Path | Owns terms about |
|---|---|---|
| core | `packages/domains/core/` | health, ping, cross-cutting diagnostic primitives |
| ingestion | `packages/domains/ingestion/` | Drive `Folder`s, `Source`s, `Manifest`s, `Extraction`s, `Outline`s, `Span`s, `Connector`s |
| wiki | `packages/domains/wiki/` | `Wiki`, `WikiPage` (Concept/Summary/Answer/**Index**), `WikiSchema`, `PageType`, `Relation`, `Backlink`, `Citation`, `Claim`, `CompileRun` |
| chat | `packages/domains/chat/` | `Conversation`, `Turn`, `Question`, `Answer`, `AnswerSegment`, `Artifact`, `CitationChip` |
| verification | `packages/domains/verification/` | `LintRun`, `LintFinding`, `Verdict`, `Correction`, `Audit` |

Bold terms are third-leap additions (adaptive `WikiSchema` and generative `Artifact` answers).

## Cross-references

When the same word means different things in different contexts, list both meanings here:

| Word | ingestion | wiki | chat | verification |
|---|---|---|---|---|
| Page | PDF/Slide page (1-indexed integer) | `WikiPage` (markdown page) | — | — |
| Source | Raw fetched immutable record | Citation provenance reference | — | — |
| Compile | — | The operation producing a `Wiki` | — | — |
| Claim | — | A cited assertion in a `WikiPage` | — | The audit subject (same identity as wiki) |

## Adding a term

1. Pick the smallest context where the term lives.
2. Add it to that context's `glossary.md` with definition + banned synonyms.
3. Add it to that context's `.cspell/glossary.txt`.
4. If the term meaningfully exists in 2+ contexts, add a cross-reference row above.
5. Only then write code that uses the term.
