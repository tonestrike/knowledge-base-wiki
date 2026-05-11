# Perspective flow — how the lens reaches every prompt

Companion to [`code-tour.md`](./code-tour.md). Diagrams the path the
perspective text takes from the user's textarea into every model call
during the compile, with file:line references.

## Compile-time flow

Click any node to jump to its implementation.

```mermaid
flowchart TD
    UX["User's textarea<br/>PerspectivePicker"] --> Presets["Preset bodies<br/>perspective-presets.ts"]
    Presets --> Contract["StartCompileInput.perspective<br/>compile.ts"]
    Contract --> Run["compileFolder<br/>compile-folder.ts"]

    Run --> Stage1["inferSchema<br/>stage: schema"]
    Run --> Stage2["planCompile<br/>stage: plan"]
    Run --> Stage3["researchSource<br/>stage: research"]
    Run --> Stage4["draftPage<br/>stage: draft"]
    Run --> Stage5["narrateIndexes<br/>stage: narrate"]

    Stage1 --> Helper
    Stage2 --> Helper
    Stage3 --> Helper
    Stage4 --> Helper
    Stage5 --> Helper

    Helper["withPerspective + STAGE_DIRECTIVES<br/>perspective-preamble.ts"] --> Persist["d1-wiki-repo.insert<br/>wikis.perspective column"]

    click UX "../../apps/web/src/routes/ingest.tsx#L246" "PerspectivePicker component"
    click Presets "../../apps/web/src/lib/perspective-presets.ts#L37" "PERSPECTIVE_PRESETS preset bodies"
    click Contract "../../packages/contracts/src/wiki/compile.ts#L31" "StartCompileInput zod schema"
    click Run "../../packages/domains/wiki/src/application/compile-folder.ts#L147" "compileFolder orchestrator"
    click Stage1 "../../packages/domains/wiki/src/application/infer-schema.ts#L66" "inferSchema implementation"
    click Stage2 "../../packages/domains/wiki/src/application/plan-compile.ts#L71" "planCompile implementation"
    click Stage3 "../../packages/domains/wiki/src/application/research-source.ts#L89" "researchSource implementation"
    click Stage4 "../../packages/domains/wiki/src/application/draft-page.ts#L129" "draftPage implementation"
    click Stage5 "../../packages/domains/wiki/src/application/narrate-indexes.ts#L64" "narrateIndexes implementation"
    click Helper "../../packages/domains/wiki/src/application/perspective-preamble.ts#L138" "withPerspective enforcement scaffold"
    click Persist "../../packages/domains/wiki/src/infrastructure/d1-wiki-repo.ts" "D1 wikis repo (insert/update)"

    classDef edge fill:#1a2332,stroke:#4a90e2,color:#fff;
    classDef stage fill:#2a1f3d,stroke:#a878d8,color:#fff;
    classDef enforce fill:#3d2a1f,stroke:#d89878,color:#fff;
    class UX,Persist edge;
    class Stage1,Stage2,Stage3,Stage4,Stage5 stage;
    class Helper enforce;
```

## Chat-time flow — picking the lens back up

Click any node to jump to its implementation.

```mermaid
flowchart LR
    Q["User question<br/>chat.ask"] --> Turn["runChatTurn"]
    Turn --> Meta["wikiReader.getWikiMeta"]
    Meta --> Agent["AgenticResearcher"]
    Meta --> Synth["AiSdkSynthesizer"]

    Agent --> AgentSys["System prompt with<br/>Wiki taxonomy block"]
    AgentSys --> Tools["4 tools<br/>listPagesByType / searchWiki /<br/>searchSources / readWikiPage"]
    Tools --> Findings["Pages → findings<br/>quoteText = full body"]

    Findings --> Synth
    Synth --> Ctx["User message with<br/>wiki-context block"]
    Ctx --> Answer["AnswerEvent stream<br/>prose + citations + artifacts"]

    click Turn "../../packages/domains/chat/src/application/run-chat-turn.ts#L82" "runChatTurn — main loop"
    click Meta "../../apps/api/src/build-chat-context.ts#L168" "DirectWikiReader.getWikiMeta"
    click Agent "../../packages/domains/chat/src/infrastructure/agentic-researcher.ts#L170" "createAgenticResearcher"
    click AgentSys "../../packages/domains/chat/src/infrastructure/agentic-researcher.ts" "buildSystem — injects taxonomy"
    click Tools "../../packages/domains/chat/src/infrastructure/agentic-researcher.ts" "tools = { searchWiki, readWikiPage, searchSources, listPagesByType }"
    click Synth "../../packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts#L492" "createAiSdkSynthesizer"
    click Ctx "../../packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts" "renderContextHeader"

    classDef edge fill:#1a2332,stroke:#4a90e2,color:#fff;
    classDef ctx fill:#3d2a1f,stroke:#d89878,color:#fff;
    class Q,Answer edge;
    class AgentSys,Ctx ctx;
```

`(*)` `researchSource` runs once per source; `draftPage` runs once per
`(pageType, title)` bucket. Everything else runs once per compile.

## File map

| Step | Implementation | What it does for perspective |
|---|---|---|
| 1. UX | [`ingest.tsx:246` `PerspectivePicker`](../../apps/web/src/routes/ingest.tsx#L246) | Vertical preset list + editable textarea |
| 1a. Presets | [`perspective-presets.ts:37` `PERSPECTIVE_PRESETS`](../../apps/web/src/lib/perspective-presets.ts#L37) | Editable `prompt` text per preset |
| 2. Contract | [`compile.ts:31` `StartCompileInput`](../../packages/contracts/src/wiki/compile.ts#L31) | `perspective?: string` (max 4000 chars) |
| 3. Handler | [`interface/index.ts:59` `startCompile`](../../packages/domains/wiki/src/interface/index.ts#L59) | Passes through to dispatcher |
| 4. Dispatcher port | [`ports.ts:101` `CompileRunDispatcher`](../../packages/domains/wiki/src/application/ports.ts#L101) | `start({ ..., perspective })` |
| 5. DO client | [`cf-compile-run-dispatcher.ts:19` `createCfCompileRunDispatcher`](../../packages/domains/wiki/src/infrastructure/cf-compile-run-dispatcher.ts#L19) | POSTs `{ ..., perspective }` to the DO |
| 6. DO | [`compile-run-do.ts:131` `run`](../../packages/domains/wiki/src/infrastructure/durable_objects/compile-run-do.ts#L131) | Calls `compileFolder({ ..., perspective })` |
| 7. Orchestrator | [`compile-folder.ts:147` `compileFolder`](../../packages/domains/wiki/src/application/compile-folder.ts#L147) | Threads perspective into each stage |
| 8a. Schema | [`infer-schema.ts:66` `inferSchema`](../../packages/domains/wiki/src/application/infer-schema.ts#L66) | `withPerspective(SYSTEM, perspective, { stage: 'schema' })` |
| 8b. Plan | [`plan-compile.ts:71` `planCompile`](../../packages/domains/wiki/src/application/plan-compile.ts#L71) | `{ stage: 'plan' }` |
| 8c. Research | [`research-source.ts:89` `researchSource`](../../packages/domains/wiki/src/application/research-source.ts#L89) | `{ stage: 'research' }` |
| 8d. Draft | [`draft-page.ts:129` `draftPage`](../../packages/domains/wiki/src/application/draft-page.ts#L129) | `{ stage: 'draft' }` |
| 8e. Narrate | [`narrate-indexes.ts:64` `narrateIndexes`](../../packages/domains/wiki/src/application/narrate-indexes.ts#L64) | `{ stage: 'narrate' }` |
| 9. Enforcement | [`perspective-preamble.ts:138` `withPerspective`](../../packages/domains/wiki/src/application/perspective-preamble.ts#L138) + [`STAGE_DIRECTIVES`](../../packages/domains/wiki/src/application/perspective-preamble.ts#L12) | HARD-CONSTRAINT preamble + per-stage clauses |
| 9a. User-message reminder | [`perspective-preamble.ts:166` `perspectiveUserHeader`](../../packages/domains/wiki/src/application/perspective-preamble.ts#L166) | One-line restatement on every USER message |
| 10. Persist | [`d1-wiki-repo.ts`](../../packages/domains/wiki/src/infrastructure/d1-wiki-repo.ts) | `INSERT/UPDATE wikis (..., perspective)` |
| 11. Migration | [`002_perspective.sql`](../../packages/domains/wiki/src/infrastructure/migrations/002_perspective.sql) | `ALTER TABLE wikis ADD COLUMN perspective TEXT` |
| 12. Chat read | [`run-chat-turn.ts:82` `runChatTurn`](../../packages/domains/chat/src/application/run-chat-turn.ts#L82) | Calls `getWikiMeta()` → builds `wikiContext` |
| 13. Chat agent prompt | [`agentic-researcher.ts:123` `buildSystem`](../../packages/domains/chat/src/infrastructure/agentic-researcher.ts#L123) | Injects taxonomy block (PageTypes + perspective) |
| 14. Chat synth header | [`ai-sdk-synthesizer.ts:262` `renderContextHeader`](../../packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts#L262) | Prepends `<wiki-context>` to USER message |

## What each enforcement clause looks like

The preamble (top of every system prompt when perspective is set):

```
========================================================================
PERSPECTIVE (load-bearing — read first, apply throughout):

{user's perspective text — e.g. "Read this corpus as a founder hunting
for a business to start, fund, or expand…"}

------------------------------------------------------------------------
This perspective is a HARD CONSTRAINT on your output, not a soft
suggestion. The user paid for a wiki built UNDER THIS LENS — produce
that, not a generic wiki of the corpus.

Rules:
1. Every PageType name, every page title, every section heading must
   read as if a perspective-holder authored it.
2. Rank what to include by the perspective's priorities.
3. Frame every finding around its IMPLICATION under the perspective.
4. If you catch yourself producing output that could come from any wiki
   of any corpus on any topic, STOP and re-anchor. Generic = wrong.
5. Structural rules in the prompt below always win.
…
{stage-specific clause}
========================================================================

{original system prompt}
```

Stage clauses live in
[`perspective-preamble.ts:12` `STAGE_DIRECTIVES`](../../packages/domains/wiki/src/application/perspective-preamble.ts#L12).

## The user-message header

In addition to the system preamble, every USER message gets prepended
with a one-line reminder via `perspectiveUserHeader()`:

```
Reminder — apply the PERSPECTIVE from the system message to everything
below. PageType names, titles, and findings must reflect that lens,
not the corpus's literal shape.

{actual prompt content}
```

Repetition through both channels is the most reliable enforcement we
have short of fine-tuning. Documented at
[`perspective-preamble.ts:138`](../../packages/domains/wiki/src/application/perspective-preamble.ts#L138).

## At chat time — the lens is still on

When a question arrives,
[`run-chat-turn.ts:82` `runChatTurn`](../../packages/domains/chat/src/application/run-chat-turn.ts#L82)
calls `wikiReader.getWikiMeta(wikiId)` (implemented in
[`build-chat-context.ts:168` `createDirectWikiReader`](../../apps/api/src/build-chat-context.ts#L168))
to fetch `{ perspective, pageTypes, folderName }` from the wiki record.

Two paths use this:

1. **Agent system prompt** —
   [`agentic-researcher.ts:123` `buildSystem`](../../packages/domains/chat/src/infrastructure/agentic-researcher.ts#L123)
   builds a per-wiki system prompt with the PageType taxonomy + the
   first line of the perspective text. The agent then knows to call
   `listPagesByType("Opportunity")` (defined in the
   [`tools = { ... }`](../../packages/domains/chat/src/infrastructure/agentic-researcher.ts#L224)
   block) when the user asks about "business ideas".
2. **Synth user message** —
   [`ai-sdk-synthesizer.ts:262` `renderContextHeader`](../../packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts#L262)
   prepends a `<wiki-context>` block with the perspective + section
   list so the synth knows the framing is deliberate and doesn't
   hallucinate "this wiki doesn't cover X" on vocabulary gaps.

That's the loop. Every stage of compile, every stage of chat, knows
the perspective. Three different perspectives on the same folder → three
different wikis → three different chat experiences.
