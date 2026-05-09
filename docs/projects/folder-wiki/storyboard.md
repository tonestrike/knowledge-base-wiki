# Take-home demo storyboard

Working backward from the submission video. The video is the deliverable; the
code is the artifact backing it. Every architectural decision serves one of the
three unforgettable moments below.

## Submission constraints

- 10–20 min unlisted YouTube video (must be at least 10 min).
- Required sections, in order: product demo (≤ half the video), tech stack,
  architectural decisions, technical trade-offs.
- Public GitHub repo with a clear `README.md` for run/test.
- Deployed live link.

## Product framing

**Compile a Folder into an LLM Wiki.** Paste a Drive folder URL. The agent
compiles every doc into a navigable, interlinked markdown wiki — concept pages,
backlinks, span-anchored citations to the source documents. Chat answers from
the synthesized wiki, not raw chunks. A lint/verification loop periodically
re-checks wiki claims against the original spans and flags any that don't hold
up.

This is Andrej Karpathy's LLM-Wiki pattern (April 2026), with the lint loop
addressing the known critique that hallucinations get baked in as "facts" when
an LLM compiles sources.

## Three unforgettable moments

1. **The compile.** Paste a folder URL → live trace pane shows planner /
   researcher / compiler agents working → left pane fills with linked wiki
   pages as they're written. Knowledge being *built*, not searched.
2. **Cross-document Q&A with span-jumping citations.** Ask a hard question that
   needs ≥3 source documents. Every claim has a citation chip. Click any chip
   → the source PDF opens to the right page with the exact span highlighted in
   the document. Acrobat-grade.
3. **The lint catches a planted hallucination on stage.** Run the verifier on
   the wiki. It finds a wiki page making a claim its sources don't actually
   support, flags it inline, offers a one-click correction with a fresh
   citation. The reliability moment.

If a feature doesn't serve one of these three, cut it.

## Beat-by-beat (target 16 min)

| Time | Beat | On screen | Why |
|---|---|---|---|
| 0:00 – 0:30 | Cold open | Karpathy's gist briefly, cut to our app | Anchors in current discourse, signals trajectory awareness |
| 0:30 – 3:00 | **Moment 1** — paste folder URL → live compile trace → wiki appears | Drive folder picker; right pane = live agent trace (planner → researchers → compiler → linker); left pane = wiki pages populating with backlinks | The "ah-ha" |
| 3:00 – 5:30 | **Moment 2** — hard cross-doc Q&A | Chat pane on right; user asks a question requiring synthesis across 3+ docs; answer streams in with inline citation chips; click chip → PDF.js modal opens to source page with span highlighted | Citation UX |
| 5:30 – 7:00 | **Moment 3** — lint catches planted hallucination | Click "Lint wiki"; verifier overlay shows a flagged claim with the original span next to it; click "Fix" → page updates with corrected claim and new citation | Reliability story |
| 7:00 – 10:00 | Tech stack + why | Architecture diagram | Bun + Turbo + Hono on CF Workers + Vite/React + oRPC + DDD; Sonnet for compile (structured outputs + citations), Haiku for lint (cheap + fast) |
| 10:00 – 13:00 | Architectural decisions | Component graph + agent topology | Why DDD: bounded contexts force the seams (ingestion / wiki / chat / verification); contract-first oRPC for the artifact protocol; SSE for compile stream vs Durable Object WebSocket for chat; citation as `(source_doc_id, byte_range, hash)` rendered with PDF.js |
| 13:00 – 15:00 | Trade-offs | Slide | What I cut: voice mode, graph view of backlinks, multi-folder workspaces, auto-update on Drive change. What I'd productionize: incremental compile via Drive webhooks, multi-tenant isolation, embeddings as a fallback retrieval substrate when wiki outgrows context (~100 docs), lint loop as a scheduled job, abuse rate limits |
| 15:00 – 16:00 | Close | One-line thesis | "Knowledge work is moving from RAG-on-chunks to compiled, compounding wikis. With span-verified citations, this is what that looks like." |

## Cuts (not in v1)

- OpenAI Realtime voice mode.
- Graph view of backlinks (Obsidian-style).
- Multi-folder workspaces / cross-folder linking.
- Auto-update when Drive folder changes.
- Generative-UI artifact protocol (the Better-Perplexity vision); the wiki *is*
  the artifact here.

## Pre-recording checklist

- [ ] **Demo folder curated.** ~20 docs across PDF / Doc / Sheet / slide deck,
      with one **planted contradiction** for Moment 3 — must be subtle enough
      to look real but deterministic enough that the lint catches it every
      take.
- [ ] **Lint pass is deterministic on the planted contradiction.** Rerun ≥10
      times before recording; not flaky.
- [ ] **PDF.js span highlight tested end-to-end** on each citation chip in the
      demo questions.
- [ ] **Latency check.** Compile of demo folder feels responsive (< 60s for
      "wow"); chat responses stream within 2s of asking.
- [ ] **Backup recording of Moments 1–3** in case live demo fails on the day.
- [ ] **Cold-open phrasing rehearsed.** Don't read off a script — the brief
      explicitly says "no scripts, be yourself."

## What this storyboard locks in

- Product = compile-then-chat, not chat-with-RAG.
- Reliability = lint loop, not retrieval reranking.
- Citation UX = PDF.js span highlight, not link to source.
- Demo flow = compile → answer → lint, in that order.
- Out of scope = voice, graph view, multi-folder, real-time sync.

Everything downstream — bounded contexts, oRPC contracts, agent topology,
storage layer — should be the smallest design that makes the three moments
work reliably.
