# tenex chat evals

End-to-end evals that drive real chat questions against the running api
worker and score each result against expected criteria — retrieval
recall, answer fidelity, citation grounding, artifact emission, and
source coverage. Designed to prove the agentic researcher + synthesizer
actually find the right pages, ground against source text, and produce
the artifacts the synth prompt promises.

## What's here

- **`anthropic-papers-cases.ts`** — 10 hand-curated cases targeting the
  Anthropic-papers Drive folder (constitutional AI → sleeper agents →
  alignment faking, plus an off-topic mismatch case to validate the
  empty-findings fallback).
- **`run-evals.ts`** — runner. Opens a Conversation, asks each question,
  drains the SSE answer-event stream, scores against the case's
  expected criteria, prints a markdown report.

## Prerequisites

1. Both apps running locally — `bun run dev`.
2. A compiled wiki to chat against. For meaningful scores, compile the
   Anthropic-papers folder (`~/Downloads/tenex-anthropic-papers/`)
   first; the runner auto-picks the newest wiki if you don't pass one.

## Run

```sh
# All cases against the newest wiki, default api (https://api.tenex.localhost:1355)
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

## Output

A markdown report with a summary table + per-case detail (verdict,
retrieval/answer/artifact/citation scores, expanded answer text in a
collapsible block). Exit code 0 when every case fully passes, 1
otherwise — suitable for CI.

## What gets scored

Each case in `anthropic-papers-cases.ts` declares:

| Field | Pass condition |
|---|---|
| `expectedPageTitleFragments` | At least one retrieved page title contains each fragment (case-insensitive substring). |
| `expectedAnswerSubstrings` | The flattened answer text contains each substring. |
| `expectedArtifactKinds` | At least one artifact of each named kind appears. |
| `minCitationCount` | The answer emits ≥ N citation segments. |
| `expectedSourceFilenameFragments` | At least one citation's label contains each fragment. |

Verdict per case:

- ✅ **pass** — every required criterion satisfied
- ⚠️ **partial** — some signal came through but at least one criterion failed
- ❌ **fail** — no signal at all (or the stream errored out)

## Adding a case

Append a new `EvalCase` to `ANTHROPIC_PAPERS_CASES` in
`anthropic-papers-cases.ts`. Use short, distinctive substrings for the
expected fragments — case-insensitive substring matching means you can
hand-tune for forgiveness vs strictness without changing the runner.

## Why these particular cases

The 10 cases were chosen to exercise:

- Cross-paper synthesis (`evolution-rlhf-to-cai`, `cross-corpus-deception-thread`)
- Categorical retrieval (`introduces-new-benchmark`)
- Single-source numerical lookup (`many-shot-headline-number`)
- Drill-down concept extraction (`induction-heads-mechanism`, `superposition-feature-count`)
- Temporal disambiguation (`specific-vs-general-cai` — two Constitutional AI papers exist)
- Narrative progression (`sycophancy-reward-tampering`)
- Graceful off-topic handling (`off-topic-graceful-mismatch` — quantum chromodynamics)

A passing run is also a curated demo script — the question set is
deliberately interesting independent of the eval framing.
