# tenex evals

End-to-end probes that drive real traffic against the running api worker
and score the result against the wiki's invariants. Two flavors:

- **Chat evals** (`run-evals.ts`) — score the agentic researcher +
  synthesizer end-to-end on a curated question set. Retrieval recall,
  answer fidelity, citation grounding, artifact emission, source
  coverage.
- **Citation-roundtrip eval** (`citation-roundtrip.ts`) — hash-invariant
  tripwire. Walks every page of a wiki, re-hashes every citation's byte
  slice against the deployed `__source/<id>/text`, and proves the
  contract `contentHash === sha256(text.slice(start,end))` holds for
  every citation currently shipped by the api.

Both probes hit a live api (default https://tenex-api.tonyvantur.workers.dev)
and need zero local services running. The chat eval needs a compiled
wiki to chat against; the citation-roundtrip needs the wiki id of the
deploy you want to verify.

## What's here

| File | What it does |
|---|---|
| `run-evals.ts` | Chat eval runner — opens a Conversation per case, drains the SSE answer stream, scores against expected criteria, prints a markdown report. |
| `anthropic-papers-cases.ts` | 10 hand-curated chat cases targeting the Anthropic-papers Drive folder. Cross-paper synthesis, categorical retrieval, drill-down extraction, off-topic graceful-mismatch. |
| `anthropic-papers-questions.md` | Plain-text companion to the cases — the question set as a human-readable list. |
| `citation-roundtrip.ts` | Span-hash tripwire. For every citation on every page of the featured wiki, sha256s the byte slice of the source text and compares to the citation's `contentHash`. |
| `probe-chat.ts` | One-shot chat probe — asks one question, prints every SSE event verbatim. For diagnosing where the agentic loop is going janky. |
| `probe-compile.ts` | One-shot compile probe — kicks off a compile against a hard-coded folder id, prints every event from the resulting SSE stream. |
| `list-pages.ts` | Quick inventory of the newest wiki's pages (subtype, pageType, title). Sanity-check after a compile. |
| `recompile.ts` | Drops the newest wiki and re-compiles its folder from scratch. Useful after a pipeline change without re-ingesting the source PDFs. |

## Prerequisites

- **bun ≥ 1.3.0** at the repo root.
- For the chat eval: a compiled wiki on the api you're targeting. The
  runner auto-picks the newest wiki unless you pass `--wikiId=<uuid>`.
- For the citation-roundtrip: defaults are wired to the live deploy and
  featured wiki; pass `--apiUrl` / `--wikiId` to target a different deploy.
- No environment variables needed for the probes that target the live
  deploy. If you point at a local api (`https://api.tenex.localhost:1355`)
  set `NODE_TLS_REJECT_UNAUTHORIZED=0` because the local proxy uses a
  self-signed cert.

## Run

### Citation-roundtrip eval

The cheapest, most-deterministic probe. Hits zero LLMs, just D1 + R2.

```sh
# Default: featured wiki on the live deploy
bun run evals:citation-roundtrip

# A specific wiki
bun run evals:citation-roundtrip -- --wikiId=22222222-2222-4222-8222-222222222222

# A different api host (local dev, staging, etc.)
bun run evals:citation-roundtrip -- --apiUrl=https://api.tenex.localhost:1355
```

**Exit codes:** `0` = every citation re-hashed cleanly. `1` = at least one
citation failed (real bug — see "What a failure means" below).
`2` = no citations checked (wiki empty or unreachable).

**Output:**

```
[citation-roundtrip] api=https://tenex-api.tonyvantur.workers.dev
[citation-roundtrip] wikiId=cb0b020d-50ab-41cb-91d9-09a5dda547b2
[citation-roundtrip] pages: 27

[citation-roundtrip] checked: 57
[citation-roundtrip] passed : 57
[citation-roundtrip] failed : 0
[citation-roundtrip] rate   : 100.00%
```

On failure the printout names the page id, source id, byte range,
expected hash, actual hash, and reason (hash mismatch, source missing,
or byte-range out of bounds).

### Chat evals

The full agentic-loop probe. Runs every case in the question set against
the deployed wiki.

```sh
# All cases against the newest wiki, default api
bun run evals

# Single case
bun run evals -- --case=many-shot-headline-number

# Pin to a specific wiki
bun run evals -- --wikiId=22222222-2222-4222-8222-222222222222

# Hit a remote api
bun run evals -- --apiUrl=https://api.tenex.example.com

# Write the markdown report to evals/results-<timestamp>.md
bun run evals -- --write
```

**Exit codes:** `0` when every case fully passes, `1` if any case is
non-pass — suitable for CI.

**Output:** a markdown report with a summary table + per-case detail
(verdict, retrieval/answer/artifact/citation scores, expanded answer
text in a collapsible block).

### Probes (interactive debugging)

These aren't pass/fail — they print every event so you can read the
agent's behavior.

```sh
bun run evals/probe-chat.ts "your question here"
bun run evals/probe-chat.ts "Q" --apiUrl=https://tenex-api.tonyvantur.workers.dev
bun run evals/probe-chat.ts "Q" --wikiId=<uuid>

bun run evals/probe-compile.ts            # uses the hard-coded folder id
bun run evals/list-pages.ts               # inventory of the newest wiki
bun run evals/recompile.ts                # drop + recompile newest wiki
```

## What chat evals score

Each case in `anthropic-papers-cases.ts` declares:

| Field | Pass condition |
|---|---|
| `expectedPageTitleFragments` | At least one retrieved page title contains each fragment (case-insensitive substring). |
| `expectedAnswerSubstrings` | The flattened answer text contains each substring. |
| `expectedArtifactKinds` | At least one artifact of each named kind appears. |
| `minCitationCount` | The answer emits ≥ N citation segments. |
| `expectedSourceFilenameFragments` | At least one citation's label contains each fragment. |

Verdict per case:

- **pass** — every required criterion satisfied.
- **partial** — some signal came through but at least one criterion failed.
- **fail** — no signal at all (or the stream errored out).

### Why these particular cases

The 10 cases were chosen to exercise:

- Cross-paper synthesis (`evolution-rlhf-to-cai`, `cross-corpus-deception-thread`).
- Categorical retrieval (`introduces-new-benchmark`).
- Single-source numerical lookup (`many-shot-headline-number`).
- Drill-down concept extraction (`induction-heads-mechanism`, `superposition-feature-count`).
- Temporal disambiguation (`specific-vs-general-cai` — two Constitutional AI papers exist).
- Narrative progression (`sycophancy-reward-tampering`).
- Graceful off-topic handling (`off-topic-graceful-mismatch` — quantum chromodynamics).

A passing run is also a curated demo script — the question set is
deliberately interesting independent of the eval framing.

### Adding a chat case

Append a new `EvalCase` to `ANTHROPIC_PAPERS_CASES` in
`anthropic-papers-cases.ts`. Use short, distinctive substrings for the
expected fragments — case-insensitive substring matching means you can
hand-tune for forgiveness vs. strictness without changing the runner.

## What the citation-roundtrip eval proves

The chat domain's `SourceHashVerifier` runs at synth time: every
`Citation` the agent emits is re-hashed against
`text.slice(byteRange.start, byteRange.end)` of the cited source. A
mismatch kills the turn. That guarantee only works if the citations
written to D1 by the compile pipeline actually re-hash cleanly *against
the source text the api will serve at chat time*. This probe is the
out-of-band test of that invariant.

A passing run proves, for the wiki under test:

- Every `(sourceId, byteRange.start, byteRange.end, contentHash)` row in
  D1 lines up with the bytes stored at `sources/<sourceId>/text` in R2.
- The `/__source/<id>/text` proxy hands those bytes to the verifier
  unchanged (no transcoding, no truncation).
- No citation has slipped past the slice-hash migration carrying a
  whole-source hash (see the `__dev/rehash-citations` comment block in
  `apps/api/src/index.ts`).

### What a failure means

Any non-zero exit is a real bug worth escalating. Three failure modes:

| Reason | Probable cause | Fix |
|---|---|---|
| `hash mismatch` | The source text shifted under the citation, or the citation was written before the slice-hash migration. | Re-run `POST /__dev/rehash-citations` against the deploy; if it persists, the source text in R2 differs from what the compile saw — re-ingest. |
| `source text not found` | R2 has no `sources/<id>/text` object for the cited source. | Re-ingest the source. The compile shouldn't have emitted a citation against a source whose text isn't stored. |
| `byte range overruns source text` | Off-by-one in the slicer, or the source text changed length. | Look at the page id + source id in the failure printout; this is always a compile-pipeline bug. |

## Why this layout

The chat-eval cases and the citation-roundtrip eval cover orthogonal
risks. Chat evals catch *behavioral* regressions (the agent stops
finding the right page, the synthesizer stops emitting a required
artifact). The citation-roundtrip catches *data-layer* regressions (a
migration shifted source text, a compile run wrote stale hashes, the
slice-hash invariant silently broke). You want both in CI: chat evals
prove the prompt + tool loop still works; citation-roundtrip proves the
verifier's last line of defense still has clean inputs to defend.
