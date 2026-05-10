# chat — ubiquitous language

This is the canonical glossary for the **chat** bounded context. Every term used in code under `packages/domains/chat/` MUST appear here. cspell enforces this via `.cspell/glossary.txt` with `addWords: false` — adding a new term requires editing both files in the same PR.

## Aggregate

`Conversation` is the aggregate root, scoped to one user and one `Wiki`.

## Terms

| Term | Definition | Notes |
|---|---|---|
| Conversation | An ordered sequence of `Turn`s scoped to one user and one `Wiki`. | Aggregate root. Persisted in D1; streams via Durable Object WebSocket. |
| Turn | A user `Question` paired with the assistant's `Answer`. | Atomic unit of a `Conversation`. |
| Question | The user's raw input for one `Turn`. | |
| Answer | The assistant's response for one `Turn`. Composed of an ordered list of `AnswerSegment`s. | |
| AnswerSegment | A unit of the streaming `Answer`: prose, citation, or `Artifact`. Streamed in order. | Discriminated union. |
| Artifact | An interactive React component picked by the `Synthesizer` per question (e.g. ComparisonTable, Timeline, LineChart, BarChart, KeyMetric, CodeBlock, Quote, Markdown). Has typed props + a citations array. | Third-leap addition. Closed registry; structured-output schema enforces the registry. |
| CitationChip | The rendered representation of a `Citation` in an `AnswerSegment`. Clickable; opens the source via citation-flight modal at the cited `Span`. | UI concept with a domain mirror because the protocol streams it. |
| Researcher | The agent that reads the `Wiki` to gather information for an `Answer`. Runs on Haiku 4.5. | |
| Synthesizer | The agent that composes the `Answer` from `Researcher` findings, picking an `Artifact` when appropriate. Runs on Sonnet 4.6 via OpenRouter through the Vercel AI SDK `streamObject`. | |
| Finding | A `Researcher`-produced unit feeding the `Synthesizer`: a verbatim quote drawn from a `WikiPage` body, paired with the `Citation`s that support it. | One `Researcher` pass produces zero or more `Finding`s. |
| Dispatcher | The infrastructure surface a `Conversation` calls to start a `Turn` run and to `subscribe` to its `AnswerEvent`s. | Backed by an in-memory broker in tests and a Cloudflare Durable Object in production. |
| AnswerEvent | The wire shape streamed for a `Turn`: `AnswerStarted`, `AnswerSegment`, `AnswerProseDelta`, `AnswerFailed`, `AnswerFinished`. | Defined in `@package/contracts/chat`; transported via oRPC `eventIterator`. |
| AnswerProduced | Domain event emitted when a `Turn` finishes; the `wiki` context may consume it to file an `AnswerPage`. | Schema in `@package/contracts/events`; published through the injected `EventBus`. |
| WikiReader | A read-only port the `Researcher` uses to fetch `WikiPage`s for a `Wiki`. Implemented over the typed oRPC client to keep `chat` from importing `domains/wiki`. | |
| SourceHashVerifier | A port that re-hashes the bytes a `Citation` covers and rejects mismatches before any `AnswerSegment` carrying that `Citation` is emitted. | The fabrication tripwire; a single failure aborts the `Turn` with `AnswerFailed`. |

## Banned synonyms

| Don't write | Write |
|---|---|
| message | `Turn` (or `Question` / `Answer` per direction) — "message" is too thread-app generic |
| response | `Answer` |
| chat (in code) | `Conversation` |
| prompt (referring to user input) | `Question` — "prompt" stays valid for LLM internals |
| reply | `Answer` |
| token (streaming) | `AnswerSegment` — tokens are LLM internals; segments are the protocol |
| component (when referring to an `Artifact`) | `Artifact` |
| widget | `Artifact` |

## Cross-context notes

- The chat context never mutates the `Wiki`. To file an `Answer` back as an `AnswerPage`, chat emits an `AnswerProduced` domain event; wiki consumes it.
- `Citation` and `Span` are read-only here, sourced via the contracts seam from wiki and ingestion respectively.
- `Artifact` is owned here. Its component registry is part of the contracts seam (so the UI can render it); the `Synthesizer`'s structured-output schema enforces the closed set.
