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
| AnswerEvent | The wire shape streamed for a `Turn`: `AnswerStarted`, `WikiPageRetrieved`, `AnswerSegment`, `AnswerProseDelta`, `AnswerFailed`, `AnswerFinished`. | Defined in `@package/contracts/chat`; transported via oRPC `eventIterator`. |
| WikiPageRetrieved | An `AnswerEvent` fired by the dispatcher once per `WikiPage` returned by the wiki search, carrying `wikiPageId`, `title`, optional `pageType`, and citation count. | Lets the UI render an "agent thoughts" log of what's actually being read. |
| AnswerThinking | An `AnswerEvent` carrying one line of live train-of-thought from the `Synthesizer` — narrates partial `Artifact` tool inputs (column names, row labels, …) so the reasoning bubble keeps moving while the model spends 15-25s drafting a tool call. Throttled adapter-side. | Composed agentically; never hand-rolled text. |
| AnswerProduced | Domain event emitted when a `Turn` finishes; the `wiki` context may consume it to file an `AnswerPage`. | Schema in `@package/contracts/events`; published through the injected `EventBus`. |
| WikiReader | A read-only port the `Researcher` uses to fetch `WikiPage`s for a `Wiki`. Implemented over the typed oRPC client to keep `chat` from importing `domains/wiki`. Surfaces three reads: `searchPages`, `getPage`, `searchSources`. | |
| Vectorize | Cloudflare's managed vector index binding. Backs the semantic-search fallback path for BOTH `WikiReader.searchSources` AND `WikiReader.searchPages` (the agent's `searchWiki` tool) — query text is embedded via OpenRouter and the top-K nearest records are mapped back to `Source` rows or `WikiPage`s by metadata kind. The composition root injects a `VectorWikiReader` that wraps the existing token-overlap reader; when the binding is missing, search falls through to the token-overlap implementation with zero behavior change. | The index name in production is `tenex-sources`; dimensionality is 1536 (matching `text-embedding-3-small`); the metric is cosine. Each vector carries a `kind: 'source' \| 'page'` metadata discriminator. |
| embedding | A dense vector representation of a `Source` chunk, a `WikiPage`, or a query string. Sources are chunked into 1000-char windows with 200-char overlap; wiki pages are embedded whole (title + body, no chunking — pages are 500-2k chars post-compile). All three flow through the same `text-embedding-3-small` model. Embeddings never replace `Citation`s — the fabrication tripwire remains the only path that mints them. | Provided by `openai/text-embedding-3-small` via the injected `Embedder` port. |
| cosine | The distance metric the `Vectorize` index uses to rank embeddings against the query embedding. | Set at index-creation time; changing it requires recreating the index. |
| OpenRouter | Provider used for every LLM call AND the embeddings call. The `Synthesizer` + `Researcher` run on `anthropic/claude-sonnet-4.6`; the `Embedder` runs on `openai/text-embedding-3-small`. Both reach the underlying model through OpenRouter's OpenAI-compatible endpoints (`/api/v1/chat/completions` and `/api/v1/embeddings`). One key — `OPEN_ROUTER_API_KEY` — powers the entire chat surface. | |
| SourceSearchHit | A match returned by `WikiReader.searchSources` — `{ sourceId, excerpt, byteRange, contentHash, citingPages }`. Discovery only: the agent uses `citingPages` to drill back into real `WikiPage`s; raw source matches never mint new `Citation`s, so the fabrication tripwire stays intact. | |
| SourceHashVerifier | A port that re-hashes the bytes a `Citation` covers and rejects mismatches before any `AnswerSegment` carrying that `Citation` is emitted. | The fabrication tripwire; a single failure aborts the `Turn` with `AnswerFailed`. |
| CitationTripwireError | The typed error a `Synthesizer`-driven use-case throws when a citation invariant is violated (unknown id, hash mismatch, invalid `Artifact` shape). | Distinguishes a fabrication-tripwire abort from an infrastructure error so the dispatcher logs and reshapes them differently. |
| ConversationNotFoundError | Typed not-found error for `Conversation` lookups; the interface boundary maps it to `ORPCError('NOT_FOUND')`. | |
| TurnNotFoundError | Typed not-found error for `Turn` lookups; the interface boundary maps it to `ORPCError('NOT_FOUND')`. | |
| Agentically | Adverb: "by way of an LLM agent." Used to describe response composition that routes through the `Synthesizer`'s structured-output call rather than being hand-rolled in code. Every user-visible chat response should be authored agentically. | Linguistic discipline reminder that the `Synthesizer` is the agent loop; deterministic fallback strings are an anti-pattern. |

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
