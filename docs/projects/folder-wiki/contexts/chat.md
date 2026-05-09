# chat — ubiquitous language (draft)

Bounded context for question-and-answer over a Wiki. Read-only on the wiki;
produces Answers (composed of prose, citations, and Artifacts) that may be
filed back as `AnswerPage`s in the wiki context via domain event.

## Aggregate

`Conversation` is the aggregate root, scoped to one user and one Wiki.

## Terms

| Term | Definition | Notes |
|---|---|---|
| Conversation | An ordered sequence of Turns scoped to one user and one Wiki. | Aggregate root. Persisted in D1; streams via Durable Object WebSocket. |
| Turn | A user Question paired with the assistant's Answer. | Atomic unit of a Conversation. |
| Question | The user's raw input for one Turn. | |
| Answer | The assistant's response for one Turn. Composed of an ordered list of AnswerSegments. | |
| AnswerSegment | A unit of the streaming Answer: prose, citation, or **artifact**. Streamed in order. | Discriminated union. |
| Artifact | An interactive React component picked by the Synthesizer per question (e.g. ComparisonTable, Timeline, LineChart, BarChart, KeyMetric, CodeBlock, Quote, Markdown). Has typed props + a citations array. | Third-leap addition. Closed registry; structured-output schema enforces the registry. |
| CitationChip | The rendered representation of a `Citation` in an AnswerSegment. Clickable; opens the source via citation-flight modal at the cited Span. | UI concept with a domain mirror because the protocol streams it. |
| Researcher | The agent that reads the Wiki to gather information for an Answer. | |
| Synthesizer | The agent that composes the Answer from Researcher findings, picking an Artifact when appropriate. | |

## Banned synonyms

| Don't write | Write |
|---|---|
| message | Turn (or Question / Answer per direction) — "message" is too thread-app generic |
| response | Answer |
| chat (in code) | Conversation |
| prompt (referring to user input) | Question — "prompt" stays valid for LLM internals |
| reply | Answer |
| token (streaming) | AnswerSegment — tokens are LLM internals; segments are the protocol |
| component (when referring to an Artifact) | Artifact |
| widget | Artifact |

## Cross-context notes

- The chat context never mutates the Wiki. To file an Answer back as an `AnswerPage`, chat emits an `AnswerProduced` domain event; wiki consumes it.
- `Citation` and `Span` are read-only here, sourced via the contracts seam from wiki and ingestion respectively.
- `Artifact` is owned here. Its component registry is part of the contracts seam (so the UI can render it); the Synthesizer's structured-output schema enforces the closed set.

## cspell words

```
chat
conversation
turn
question
answer
answersegment
artifact
citationchip
researcher
synthesizer
streaming
comparisontable
timeline
linechart
barchart
keymetric
codeblock
```
