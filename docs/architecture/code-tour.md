# Tenex — code tour

A walkthrough of how tenex actually works, file-by-file, ordered the way
a user's request flows through the system. Designed as a companion to
the `/present` deck — same arc, but with the actual code.

## TL;DR — the bet

Most search systems take a user query and run it against a generic index
of the document. Tenex flips that: **the user supplies a "perspective"
before indexing**, and the compile pipeline builds a wiki shaped by that
lens. Three readers of the same book (screenwriter / philosopher /
linguist) produce three radically different wikis from the same source
text.

The technical bet: **move the agent loop upstream**. Instead of running
an agentic interpretation per chat question, pay the cost once at
ingest time. Cheap questions, deeper answers.

---

## The journey

A user does this:

1. Picks a Google Drive folder
2. Watches it ingest (each file's text + per-page byte offsets pulled
   into D1 + R2)
3. **Chooses a perspective** — a free-form lens like "find me business
   opportunities" or "scenes and characters for a screenplay"
4. The compile pipeline runs end-to-end under that lens
5. They land on the compiled wiki, can browse pages, can chat

Below, the actual code that powers each step.

---

## 1. Perspective UX — pick a lens before compile

**Where the user picks:** [`apps/web/src/routes/ingest.tsx`](../../apps/web/src/routes/ingest.tsx)

After ingest finishes, the route pauses on a `'choosing-perspective'`
phase (see the `phase` state machine in that file). It renders a
`<PerspectivePicker>` with:

- A vertical radio-list of 5 presets (Business / Novel / Engineering /
  Research / Custom) loaded from
  [`apps/web/src/lib/perspective-presets.ts`](../../apps/web/src/lib/perspective-presets.ts)
- An editable textarea pre-filled with the chosen preset's full prompt
  text. **The user sees and can edit exactly what the model will be
  told** before kicking off compile.

The "Custom" preset is just an empty starting canvas. The "Skip"
button runs a generic compile with no perspective.

**Why presets are full editable text (not labels mapped to fixed
prompts):** transparency. The user can add domain notes inline (e.g.
"we sell B2B SaaS to SMBs") and they'll thread through every prompt.

---

## 2. The compile pipeline

**Entry point:** the user clicks "Compile with this perspective →"
which calls `chat.startCompile({ folderId, perspective })` (the oRPC
procedure). That's wired in:

- Contract: [`packages/contracts/src/wiki/compile.ts`](../../packages/contracts/src/wiki/compile.ts)
  — `StartCompileInput` has an optional `perspective: z.string().min(1).max(4000).optional()`
- Handler: [`packages/domains/wiki/src/interface/index.ts`](../../packages/domains/wiki/src/interface/index.ts)
  — `startCompile` hands off to a `CompileRunDispatcher.start({ compileRunId, folderId, perspective })`
- DO dispatcher client: [`packages/domains/wiki/src/infrastructure/cf-compile-run-dispatcher.ts`](../../packages/domains/wiki/src/infrastructure/cf-compile-run-dispatcher.ts)
  — POSTs `/start` to a Durable Object, anchors the run with
  `waitUntil` so it survives the response

**The CompileRunDO** ([`packages/domains/wiki/src/infrastructure/durable_objects/compile-run-do.ts`](../../packages/domains/wiki/src/infrastructure/durable_objects/compile-run-do.ts))
hosts the multi-minute compile. Its `/start` calls
`state.waitUntil(this.run(cmd))` and its `/subscribe` streams the
event tape as SSE. This is necessary because Workers terminate after
the response; a DO is the only addressable home that survives.

The run executes [`compileFolder`](../../packages/domains/wiki/src/application/compile-folder.ts)
which orchestrates **five stages**, each backed by an LLM call.

### Stage A — SchemaInferrer

[`packages/domains/wiki/src/application/infer-schema.ts`](../../packages/domains/wiki/src/application/infer-schema.ts)

Reads the first 10 sources and returns a typed schema:

```ts
{ pageTypes: [{ name, description }], relations: [...], reason }
```

This is where the perspective bites hardest. Without perspective, the
schema picks generic PageType names (Decision / Person / Metric)
fitted to the corpus's literal shape. With perspective set, the schema
is told to **name PageTypes in the perspective's vocabulary**
(Opportunity / Pain / Wedge / Risk under a business lens).

The model is `anthropic/claude-sonnet-4.6` — quality matters here
because every downstream stage uses these names.

### Stage B — Planner

[`packages/domains/wiki/src/application/plan-compile.ts`](../../packages/domains/wiki/src/application/plan-compile.ts)

For each source, decides which PageTypes apply. Returns
`{ tasks: [{ sourceId, pageTypes }] }`.

The key prompt rule (in the perspective preamble): **a source that
"literally describes a Tool" under a business lens ALSO supports
Opportunity, Pain, Wedge, Customer, Risk findings**. The Planner
assigns multiple angles per source so the Researcher doesn't return
only Tool findings.

### Stage C — Researcher (per source, sequential)

[`packages/domains/wiki/src/application/research-source.ts`](../../packages/domains/wiki/src/application/research-source.ts)

For each `(source, pageTypes)` task, extracts findings:

```ts
{ pageType, title, evidence, spanStart, spanEnd }[]
```

The Researcher **must produce at least one finding per assigned
PageType** — reinterpreting the same source content through each angle
the perspective demands. Findings carry verbatim quotes + byte ranges
that become citations downstream.

### Stage D — Drafter (per `(pageType, title)` bucket, parallel)

[`packages/domains/wiki/src/application/draft-page.ts`](../../packages/domains/wiki/src/application/draft-page.ts)

For each bucket of related findings, writes one Concept page in
markdown. Each claim in the body is paired with citations whose byte
ranges point back into the source.

Bucketing logic (in `compile-folder.ts`):

- Group findings by `(pageType, normalizedTitle)` — each group → one page
- Cap at 24 total drafts, 8 per pageType, round-robin so no type
  starves

### Stage E — Linker + IndexBuilder

- [`resolve-backlinks.ts`](../../packages/domains/wiki/src/application/resolve-backlinks.ts)
  scans `[[link]]` markers in page bodies and resolves them through
  the schema's relation cardinality
- [`build-indexes.ts`](../../packages/domains/wiki/src/application/build-indexes.ts)
  generates one Index page per PageType (a table of contents)
- [`narrate-indexes.ts`](../../packages/domains/wiki/src/application/narrate-indexes.ts)
  writes an opinionated thesis + per-section narrative + glossary,
  also under the perspective lens

---

## 3. Perspective enforcement — the load-bearing prompt scaffold

**File:** [`packages/domains/wiki/src/application/perspective-preamble.ts`](../../packages/domains/wiki/src/application/perspective-preamble.ts)

This is where the perspective gets enforced across all five stages.
`withPerspective(systemPrompt, perspective, { stage })` prepends a
HARD-CONSTRAINT block at the top of the system message:

```
PERSPECTIVE (load-bearing — read first, apply throughout):
{user's perspective text}
------------------------------------------------------------
[universal enforcement rules — generic = wrong, etc]
[stage-specific clause — schema / plan / research / draft / narrate]
============================================================
{original system prompt}
```

The five stage-specific clauses each address a different failure mode:

- `schema` — "Do not fall back to generic PageType names because the
  corpus's literal content fits a different shape. The user picked the
  perspective PRECISELY to reshape the corpus."
- `plan` — "Almost every source supports MULTIPLE perspective-shaped
  PageTypes from different angles."
- `research` — "For EACH assigned PageType, you MUST produce at least
  one finding by REINTERPRETING the same source through that angle."
- `draft` — "Open with the IMPLICATION under the perspective, not
  with background context."
- `narrate` — "The thesis must state what this wiki IS UNDER THE
  PERSPECTIVE, not what topic the corpus is about."

`perspectiveUserHeader()` also prepends a one-line reminder to every
USER message — repetition is the most reliable enforcement we have
short of fine-tuning.

---

## 4. Storage — D1 + R2

**Tables** (migrations: [`packages/domains/wiki/src/infrastructure/migrations/`](../../packages/domains/wiki/src/infrastructure/migrations/)):

- `wikis` — id, folder_id, schema_json, perspective (added in `002_perspective.sql`)
- `wiki_pages` — id, wiki_id, subtype (Concept/Summary/Answer/Index), page_type, slug, title, body_r2_key
- `claims` — wiki_page_id, paragraph_id, claim_text
- `citations` — claim_id, source_id, byte_range_start/end, content_hash, label
- `backlinks` — from_page_id, to_page_id, relation_name

**R2 layout:**

- `wiki_pages/<page-id>.md` — the compiled page body (markdown)
- `sources/<source-id>/text` — the extracted PDF / markdown text
- `sources/<source-id>/raw` — the raw bytes (for "view original")

**Repos:**

- [`d1-wiki-page-repo.ts`](../../packages/domains/wiki/src/infrastructure/d1-wiki-page-repo.ts)
  — `insertMany` writes R2 first, then D1 in one batch; rolls back R2
  if D1 fails
- [`r2-wiki-page-storage.ts`](../../packages/domains/wiki/src/infrastructure/r2-wiki-page-storage.ts)
  — the canonical key contract: `wiki_pages/<id>.md`

---

## 5. The chat pipeline

When a user asks a question, four layers cooperate:

```
user types question
  ↓
chat.ask → ChatTurnDO.start (DO holds the tape)
  ↓
runChatTurn → researchQuestion → AgenticResearcher (4 tools)
  ↓                                  ↓
  ↓                              listPagesByType / searchWiki /
  ↓                              readWikiPage / searchSources
  ↓
synthesizeAnswer → AiSdkSynthesizer (streamText + 8 artifact tools)
  ↓
SSE stream of AnswerEvents → web/chat-transport → ai-elements
```

### Why a Durable Object for chat too

**File:** [`packages/domains/chat/src/infrastructure/durable_objects/chat-turn-do.ts`](../../packages/domains/chat/src/infrastructure/durable_objects/chat-turn-do.ts)

The in-memory dispatcher kept the per-turn tape in a `Map` scoped to
one Worker isolate. On Cloudflare, `chat.ask` and `chat.streamAnswer`
are separate HTTP requests that often land on different isolates — the
second one finds an empty tape and waits forever. The DO is keyed by
`${conversationId}:${turnId}` so both requests share state regardless
of which isolate handles each.

`ChatTurnDO` has the same two-endpoint shape as the wiki's
`CompileRunDO`:

- `POST /start` — kicks off `runChatTurn` inside `state.waitUntil`
- `GET /subscribe` — replays the tape + streams live SSE

The client adapter is
[`cf-chat-turn-dispatcher.ts`](../../packages/domains/chat/src/infrastructure/cf-chat-turn-dispatcher.ts).

### The chat-turn runner

**File:** [`packages/domains/chat/src/application/run-chat-turn.ts`](../../packages/domains/chat/src/application/run-chat-turn.ts)

Emits an ordered AnswerEvent stream:

```
AnswerStarted →
ResearchStarted →
(WikiPageRetrieved | ResearchProgress)* →
ResearchCompleted →
SynthesisStarted →
(AnswerThinking | AnswerProseDelta | AnswerSegment)* →
AnswerFinished | AnswerFailed
```

Each event is sequenced by the DO and streamed to subscribers; a late
subscriber gets a full replay.

### The agent — four tools

**File:** [`packages/domains/chat/src/infrastructure/agentic-researcher.ts`](../../packages/domains/chat/src/infrastructure/agentic-researcher.ts)

Built on `streamText({ tools, stopWhen: stepCountIs(8) })`. The agent
gets a system prompt with the wiki's **taxonomy block** (PageType
list + perspective text + folder name, fetched via
`wikiReader.getWikiMeta`) and four tools:

| Tool              | What it does                                                                                       |
|-------------------|----------------------------------------------------------------------------------------------------|
| `searchWiki`      | Token-overlap search over page title + body                                                        |
| `readWikiPage`    | Fetch a page's full body + citations by id                                                         |
| `searchSources`   | Search raw source text (PDF extracts) when page-level search misses; returns citing pages          |
| `listPagesByType` | Enumerate every Concept page in a given PageType section (browse by name instead of keyword-guess) |

The agent's first instruction: **"If the user's question maps to one
of the PageTypes in the taxonomy (e.g. 'business ideas' → Opportunity),
call `listPagesByType` FIRST."** This is the rule that fixes the
keyword-guessing failure mode.

### The synthesizer

**File:** [`packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts`](../../packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts)

Built on `streamText({ tools })` where the tools are the **artifact
registry** (ComparisonTable / Timeline / KeyMetric / Quote / etc).
Each artifact kind's `inputSchema` carries one shape; the synth picks
a tool per structured-data segment.

The agent's findings are passed in along with a **`<wiki-context>`
block** stating the perspective + section vocabulary so the synth
knows the framing is deliberate. This is what prevents the "findings
appear empty" hallucination when the user query vocabulary doesn't
match the page-body vocabulary.

Inline citation markers (`[[cite:UUID]]`) are parsed out of the prose
stream and emitted as separate `citation` segments; the use-case
verifies each citation hash before it reaches the SSE tape.

---

## 6. Citation grounding — the fabrication tripwire

Every claim in a synthesized answer must be backed by a verifiable
citation. The tripwire:

1. The synth emits `[[cite:UUID]]` markers in prose
2. The use-case
   [`synthesize-answer.ts`](../../packages/domains/chat/src/application/synthesize-answer.ts)
   resolves each UUID against the working set of findings
3. Each Citation has a `contentHash` of the byte range it covers
4. Before emission, [`SourceHashVerifier`](../../packages/domains/chat/src/application/verify-citation.ts)
   re-hashes the actual source text at that byte range and compares
5. Hash mismatch → `CitationTripwireError` → turn aborts with
   `AnswerFailed`

Source bodies live at `sources/<id>/text` in R2; the verifier reads
them via the bindings the api already holds (no oRPC round-trip).
Wired in
[`apps/api/src/build-chat-context.ts`](../../apps/api/src/build-chat-context.ts)
under `createMemorySourceHashVerifier`.

---

## 7. Frontend — chat dock + presentation

**Layout:** [`apps/web/src/App.tsx`](../../apps/web/src/App.tsx) wraps
the router + `<ChatDock>` in a horizontal flex row. The dock is
`sticky top-0 h-screen` so it always fills the viewport and stays in
view as the user scrolls the wiki page next to it. Closing animates
width to 0.

**Chat transport:**
[`apps/web/src/lib/chat-transport.ts`](../../apps/web/src/lib/chat-transport.ts)
parses oRPC SSE frames and translates each AnswerEvent into the AI
Elements `UIMessageChunk` shape:

- `WikiPageRetrieved` → `reasoning-delta` + `data-wiki-page-retrieved`
- `AnswerThinking` → `reasoning-delta` (live train-of-thought from synth)
- `AnswerProseDelta` → `text-delta`
- `AnswerSegment(citation)` → `data-citation`
- `AnswerSegment(artifact)` → `data-artifact`

**Presentation route:** [`apps/web/src/routes/present.tsx`](../../apps/web/src/routes/present.tsx)
is the 14-slide non-technical talk at `/present`. Arrow keys to
navigate, F for fullscreen.

---

## 8. Lessons / interesting bugs

A few things that bit us, ordered by impact. Useful color for a
walkthrough.

### "The chat sees fragments" — the R2 key bug

For a while, every wiki the chat surfaced returned "limited text
fragments" no matter how rich the compiled pages were. Root cause:
the chat reader was reading R2 at the bare page id (`<uuid>`) but the
canonical writer (`createR2WikiPageStorage`) writes at
`wiki_pages/<id>.md`. The chat's bodies came back empty; only the
source-text excerpts appended by `expandWithSourceEvidence` made it
into the synth prompt — and those were correctly limited to 600
chars each. Fix:
[`apps/api/src/build-chat-context.ts` `hydrate()`](../../apps/api/src/build-chat-context.ts).

### Cross-isolate dispatcher

Chat originally used an in-memory dispatcher with the tape kept in a
per-isolate `Map`. `chat.ask` and `chat.streamAnswer` are separate
HTTP requests that don't reliably hit the same isolate on Cloudflare
— the second one would create a fresh empty tape and wait forever.
Fix: the `ChatTurnDO` above.

### Perspective enforcement too soft

First implementation was "bias toward this perspective." A music/AI
corpus compiled under business-opportunities still produced
Tool/Skill/Resource PageTypes because the model fell back to the
corpus's literal shape. Fix: HARD CONSTRAINT preamble + per-stage
clauses + USER-message repetition (see `perspective-preamble.ts`).

### Researcher emitting findings for one PageType only

The Planner would assign `[Tool]` for a source about a software tool,
the Researcher would only extract Tool findings — and the
Opportunity / Pain / Wedge sections of the compiled wiki would be
empty. Fix: stage-specific clauses requiring the Planner to assign
multiple angles per source and the Researcher to produce at least one
finding per assigned PageType (the "reinterpret the same source
through each angle" rule).

### Agent keyword-guessing instead of browsing

The agent would search "ring" against a wiki that had an entire
Opportunity section and miss it because the user typed "business
ideas." Fix: the wiki taxonomy is now injected into the agent's
system prompt + the `listPagesByType` tool lets it browse by name.

---

## 9. Where to start the code tour

If you're walking someone through the codebase for the first time,
here's a 15-minute path that hits the high points:

1. [`apps/web/src/lib/perspective-presets.ts`](../../apps/web/src/lib/perspective-presets.ts)
   — see what the user actually picks
2. [`packages/contracts/src/wiki/compile.ts`](../../packages/contracts/src/wiki/compile.ts)
   — see how perspective enters the contract layer
3. [`packages/domains/wiki/src/application/compile-folder.ts`](../../packages/domains/wiki/src/application/compile-folder.ts)
   — read the orchestrator top to bottom (one function, ~600 lines)
4. [`packages/domains/wiki/src/application/perspective-preamble.ts`](../../packages/domains/wiki/src/application/perspective-preamble.ts)
   — the universal + stage-specific enforcement clauses
5. [`packages/domains/wiki/src/application/infer-schema.ts`](../../packages/domains/wiki/src/application/infer-schema.ts)
   — see `withPerspective(SYSTEM, perspective, { stage: 'schema' })` wire up
6. [`packages/domains/chat/src/infrastructure/agentic-researcher.ts`](../../packages/domains/chat/src/infrastructure/agentic-researcher.ts)
   — the four-tool agent + the wiki-taxonomy system-prompt injection
7. [`packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts`](../../packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts)
   — the artifact-tool registry + the `<wiki-context>` block
8. [`packages/domains/chat/src/application/synthesize-answer.ts`](../../packages/domains/chat/src/application/synthesize-answer.ts)
   — the citation tripwire

The architecture overview in
[`docs/architecture/README.md`](./README.md) covers the cross-cutting
constraints (DDD bounded contexts, contract-first oRPC, glossary
discipline) if you need that context.
