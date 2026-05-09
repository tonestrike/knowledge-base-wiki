# folder-wiki demo storyboard

Working backward from the submission video. The video is the deliverable; the
code is the artifact backing it. Every architectural decision serves one of the
three Moments below.

Canonical conceptual design: [`spec.md`](spec.md). Project doc: [`../0002-folder-wiki.md`](../0002-folder-wiki.md).

## Submission constraints

- 10–20 min unlisted YouTube video (must be at least 10 min).
- Required sections, in order: product demo (≤ half the video), tech stack, architectural decisions, technical trade-offs.
- Public GitHub repo with a clear `README.md` for run/test.
- Deployed live link.
- **Presentation framing: pitching to a client**, not an engineering review.

## Product framing

**Compile a Folder into an LLM Wiki.** Connect a Drive folder. The agent inspects your documents, **generates a domain-specific wiki schema**, compiles every doc into typed wiki pages with auto-generated indexes, and lets you chat against the synthesized knowledge with **adaptive UI per question**. A verifier audits every claim against the original source spans.

Three leaps in service of one client promise — *knowledge you can trust*:

1. **Adaptive wiki schema** — the *shape* of your knowledge is generated per folder.
2. **Generative artifact answers** — the *retrieval UI* adapts to the question.
3. **Span-verifying lint loop** — every claim is provably grounded; Verifier on a different model family from Compiler defeats self-grading bias.

## Three unforgettable Moments

1. **Moment 1 — Schema reveal + live compile.** Paste folder URL → SchemaInferrer streams: *"This folder is about board governance. I'll build pages for: Decisions, Metrics, People, Risks. Relations: DecidedAt, OwnedBy, RaisedIn."* Schema chips animate in. Compile theater fans out: agent lanes work in parallel, source cards fly across, typed WikiPages and per-PageType IndexPages populate the wiki tree.
2. **Moment 2 — Generative artifact answer with span-jumping citations.** Hard cross-doc question. Answer streams in as prose interleaved with `ComparisonTable` / `KeyMetric` / `LineChart` Artifacts. Every cell + every prose claim has a CitationChip. Click a chip → citation flight: chip flies into a PDF.js modal, source span lights up in-doc.
3. **Moment 3 — Lint catches a planted hallucination.** Run audit. Verifier flags a Claim whose cited Span doesn't actually support it. Ribbon overlay shows Claim text + cited Span verbatim side-by-side, and a proposed Correction with inline diff. Click "Apply" → page updates with motion.

If a feature doesn't serve one of these, demote it.

## Beat-by-beat (target 12 min, 16 min cap)

| Time | Beat | On screen |
|---|---|---|
| 0:00 – 0:30 | Cold open | Two-line client problem: "Your team's knowledge is in Drive. RAG hallucinates. Notion is manual. We compile your folder into a wiki you can trust." |
| 0:30 – 0:45 | Folder pick | Drive folder URL pasted; Connector spins |
| 0:45 – 1:05 | **Schema reveal** | SchemaInferrer streams: *"Reading 8 sources... I see this folder is about board governance. I'll build pages for: Decisions, Metrics, People, Risks."* Schema chips animate in. |
| 1:05 – 2:30 | Compile theater | Three lanes: Sources / Agents (Researcher × 5 + Drafter + Linker + IndexBuilder) / Pages. Source cards fly across; wiki tree populates left; per-PageType IndexPages light up last. |
| 2:30 – 3:00 | Browse the wiki | "Decisions" IndexPage → list of all Decisions. Click one → magazine-layout ConceptPage with sidebar citations. **Concrete signal of intelligence: every folder gets a different shape.** |
| 3:00 – 3:15 | Question typed | "What's our Q3 NRR trajectory and how does it compare to our targets?" |
| 3:15 – 4:00 | **Moment 2** — artifact answer | Answer streams: prose → `ComparisonTable` (Quarter/Target/Actual/Variance + sparkline) → prose → `KeyMetric`. Every cell + claim cited. |
| 4:00 – 4:30 | Citation flight | Click chip on "Q3 Actual" cell → chip flies into PDF.js modal; cited Span lights up in-doc. Modal closes; chip returns. |
| 4:30 – 5:30 | **Moment 3** — lint catches | Run audit. Verifier flags a Claim asserting NRR was 110% but cited Span says 105%. Ribbon: Claim | cited Span verbatim. Correction inline-diff. Click "Apply" → page updates. |
| 5:30 – 7:30 | Trade-offs (production roadmap) | "What I'd ship next for you": multi-folder workspaces, incremental compile via Drive webhooks, embeddings as a fallback substrate beyond ~100 docs, multi-tenant isolation. Each framed as production work, not as cuts. |
| 7:30 – 9:30 | Tech stack | Bun + Turbo + Hono on Cloudflare Workers + Vite/React + oRPC + DDD. Brief — the *what* matters more than the *why* in a client pitch. |
| 9:30 – 11:30 | Architectural decisions | Why DDD (forced clean parallelism); why contract-first (5x parallel build); why three leaps (one promise). |
| 11:30 – 12:00 | Close | "Knowledge work moving from RAG-on-chunks to compiled, typed, verified wikis. Every claim provably grounded." |

## Cuts (not in v1)

- OpenAI Realtime voice mode
- Graph view of backlinks (Obsidian-style)
- Multi-folder workspaces / cross-folder linking
- Auto-update on Drive change (webhooks + incremental compile)
- Embeddings-as-fallback hybrid (called out as production roadmap)

## Pre-recording checklist

- [ ] **Demo folder curated.** ~20 board-governance docs (PDF / Doc / Sheet / slide deck mix) with one **subtle planted contradiction** for Moment 3 — deterministic enough that the lint catches it every take.
- [ ] **Lint pass is deterministic.** Rerun ≥10 times before recording; not flaky.
- [ ] **PDF.js citation flight tested end-to-end** on every demo question's chips.
- [ ] **Latency check.** Compile feels responsive (< 60s); chat answers start streaming within 2s.
- [ ] **Backup recording of Moments 1–3** captured separately in case live demo fails.
- [ ] **Cold-open phrasing rehearsed.** No script per the brief; "be yourself."

## What this storyboard locks in

- Product = compile-then-chat with adaptive schema and generative artifact answers, **not** chat-with-RAG.
- Reliability = span-verifying lint loop with a different-family Verifier.
- Citation UX = chip → citation flight → PDF.js modal with span-anchored highlight.
- Demo flow = schema reveal → compile → artifact answer → citation flight → lint catches.
- Out of scope = voice, graph view, multi-folder, real-time sync, embeddings.

Everything downstream — bounded contexts, oRPC contracts, agent topology, storage layer, UI design system — should be the smallest design that makes the three Moments work reliably.
