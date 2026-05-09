# wiki — ubiquitous language (draft)

Bounded context for the compiled, interlinked knowledge graph derived from
Sources. The wiki is the model that the chat and verification contexts read
against.

## Aggregate

`Wiki` is the aggregate root, scoped to one Folder. A Wiki contains many
WikiPages; pages link to each other via Backlinks; pages cite Sources via
Citations attached to Claims.

## Terms

| Term | Definition | Notes |
|---|---|---|
| Wiki | The aggregate of all WikiPages produced from a Folder. One Wiki per Folder. | Aggregate root. |
| WikiPage | A single markdown page in the wiki. One of three subtypes: ConceptPage, SummaryPage, AnswerPage. | Distinct from `Page` in ingestion context. |
| ConceptPage | A WikiPage about a single entity, person, project, decision, or term that emerges across multiple Sources. | Subtype of WikiPage. |
| SummaryPage | A per-Source WikiPage synthesizing what that Source says, plus its dependencies and dependents. | Subtype of WikiPage. |
| AnswerPage | A WikiPage filed back from a chat Q&A; preserves a hard question and its researched answer. | Subtype of WikiPage. Filed via domain event from chat. |
| Backlink | A directed reference from one WikiPage to another. The link graph is the dependency structure for incremental recompile. | |
| Citation | A `(Span, label)` pair attached to a Claim in a WikiPage. Every Claim is cited. | |
| Claim | A verifiable assertion in a WikiPage. The atomic unit the verification context audits. | Same identity as `Claim` in verification. |
| Compile | The operation that takes a Folder + its Sources and produces (or updates) a Wiki. | |
| CompileRun | A single invocation of Compile. Has a status, started-at, ended-at, emits CompileEvents. | |
| CompileEvent | A streamed event during a CompileRun. e.g. SourceIngested, PageDrafted, BacklinkResolved, CompileFinished. Drives the live trace UI. | |
| Compiler | The composite agent performing Compile: planner + researchers + drafter + linker. | Application-layer concept. |

## Banned synonyms

| Don't write | Write |
|---|---|
| embedding / vector / index | (avoid) — we don't vector-index the wiki; agentic search reads it directly |
| chunk | Span (and Spans live on Sources, not WikiPages) |
| page (alone) | WikiPage |
| section | WikiPage or Outline section (per context) |
| Source (as the cited thing) | CitedSource (when standalone) or Citation (the relationship) |
| build | Compile |
| graph | Wiki (the whole) or Backlinks (the link structure) |

## Cross-context notes

- `Source` here is citation provenance, not the raw fetched record (which lives in ingestion). Prefer `Citation.source` or `CitedSource` in code.
- `Page` always means `WikiPage`; ingestion's PDF page integer is different.
- `Claim` is the join point with verification — same identity, different concerns (wiki structures it, verification audits it).

## cspell words

```
wiki
wikipage
conceptpage
summarypage
answerpage
backlink
citation
claim
compile
compilerun
compileevent
compiler
linker
drafter
recompile
markdown
interlinked
```
