# BUGS_AND_FIXES — an engineering log

This file is an engineering log, not a changelog. The changelog says what shipped; this one says what broke, what we learned, and which invariant the fix encoded. Every entry is a real commit — symptom from the user-visible failure, root cause from the diff, snippet from the file we changed.

What you can learn here: the failure modes of a typed-citation wiki system spanning four bounded contexts (`ingestion`, `wiki`, `chat`, `verification`), an LLM SDK whose schema validator changes shape under load, two storage primitives (D1 + R2), a Durable-Object runtime where state hops isolates, and an SSE wire that has to survive dev hot reloads. The themes: span identity is fragile, schema rejection is real, isolate-locality is not a default, and "the LLM said so" never passes the verifier alone.

Architecture lives in `docs/architecture/` and `docs/projects/`. Trace any entry with `git show <sha>`.

---

## 1. Citations hashed the whole source, not the cited slice

`b727140` · `packages/domains/wiki/src/application/compile-folder.ts`

**Symptom.** Every chat answer aborted mid-stream. The verifier tripwire fired on the first citation; the UI surfaced "findings are empty fragments."

**Root cause.** Compile stamped each `Citation.span.contentHash` with the *whole-source* hash. Chat's `SourceHashVerifier` recomputes the hash over `text.slice(start, end)`. The two ends of the span value-object disagreed about what `contentHash` even meant. A span carrying the wrong hash is worse than one carrying no hash — it falsely advertises "verified."

**Fix.** Hoist a `sliceHash(text, start, end)` helper, hash the actual slice each citation covers, fail loud if the Drafter points at a sourceId not in the findings.

```ts
// packages/domains/wiki/src/application/compile-folder.ts
const sliceHash = async (text: string, start: number, end: number): Promise<ContentHash> => {
  const slice = text.slice(start, end);
  const bytes = new TextEncoder().encode(slice);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', ab);
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}` as ContentHash;
};
```

**Lesson.** A value object's identity field must be computed identically on both sides of every boundary it crosses. Companion commit `65985fe` ships a `/__dev/rehash-citations` healer — the invariant was worth backfilling, not just enforcing forward.

---

## 2. Five compounding bugs hiding behind a single hang

`9c73dfc` · `apps/api/src/build-chat-context.ts`, `packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts`

**Symptom.** Chat got "stuck on `ResearchStarted`." No SSE events after the first.

**Root cause.** Five bugs stacked, each only visible after the one above unblocked:

1. `chat.ask` returned the turnId and ran the dispatcher as `void run(args)`. Workers cancel orphaned I/O outside `ExecutionContext.waitUntil` — the first D1 await hung.
2. The chat reader hit R2 at `<id>`; the wiki writer puts at `wiki_pages/<id>.md`. Bodies empty.
3. The Synthesizer's `streamObject` discriminated-union schema hit three Anthropic rejections — empty `{}` from `z.unknown()`, recursive `z.lazy()` collapse, then "compiled grammar too large" on the 8-kind union.
4. `readSourceText` was stubbed `async () => null`; the verifier always tripwired.
5. The seed script stamped whole-source hashes (mirrors bug #1).

**Fix.** Plumb `WaitUntil` through `ChatDeps → dispatcher.start`. Rewrite the synth as `streamText` with one tool per artifact kind — Anthropic checks tool schemas one at a time, never compiling a combined grammar. Citations inline as `[[cite:UUID]]` parsed with cross-delta hold-back; re-validate each artifact against the typed `Artifact` registry at the use-case.

```ts
// packages/domains/chat/src/infrastructure/ai-sdk-synthesizer.ts
const tools = {
  textSegment: tool({ inputSchema: TextSegmentSchema, execute: ... }),
  comparisonTable: tool({ inputSchema: ComparisonTableSchema, execute: ... }),
  // one tool per Artifact kind, never a discriminated union
};
const stream = streamText({ model, tools, system: SYSTEM_PROMPT, messages });
```

**Lesson.** When a "stuck" symptom keeps shifting between fixes, the stack is hiding more than one bug. The synth-schema lesson generalizes: **Anthropic rejects large discriminated-union schemas; if you want N branches, use one tool per branch, not one tool with a union input.**

---

## 3. ChatTurnDO — in-memory dispatcher worked in dev and silently failed in prod

`7ec9fe2` · `packages/domains/chat/src/infrastructure/durable_objects/chat-turn-do.ts`

**Symptom.** "Stuck on COMPOSING ANSWER" in production. `curl`/probe always failed; the browser sometimes worked.

**Root cause.** The in-memory dispatcher kept the per-turn tape in a per-isolate `Map`. On Workers, `chat.ask` (writes) and `chat.streamAnswer` (subscribes) are separate HTTP requests and can land on different isolates. The second one finds an empty tape and waits forever. Browser keep-alive sometimes pinned both to one isolate; `curl` always lost the coin flip.

**Fix.** Lift the run loop into a shared `runChatTurn`, host it inside a `ChatTurnDO` keyed by `conversationId:turnId`. The Worker-side dispatcher becomes a thin remote client (`POST /start`, SSE-subscribe `/subscribe`).

```ts
// packages/domains/chat/src/infrastructure/durable_objects/chat-turn-do.ts
export class ChatTurnDO {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/start') {
      this.state.waitUntil(runChatTurn(this.deps, args, this.emit));
      return new Response(null, { status: 202 });
    }
    if (url.pathname === '/subscribe') return this.subscribeSSE(req);
    return new Response('not found', { status: 404 });
  }
}
```

**Lesson.** **The consistency boundary of in-memory state is one isolate.** A `Map` is not durable state on a serverless edge. If your composition root has different bindings for "tests" and "prod," validate the prod binding with a `curl` round-trip across two requests on day one.

---

## 4. SSE replay dedup on reconnect

`a5192b9` + `c8d2806` · `apps/web/src/lib/use-event-stream.ts`

**Symptom.** During a 5-min compile, wrangler hot-reloaded twice; the UI showed every `AgentThought` / `PageDrafted` event two and three times.

**Root cause.** Two layers. First, the SSE consumer's reconnect budget was 3 attempts × {1,2,4}s = ~7s of patience — not enough for a wrangler restart. Once reconnect was made patient (12 attempts, reset-on-frame), the next layer surfaced: the DO replays its full tape on every reconnect, the server dedupes by `seq` within a connection, but each reconnect creates a fresh `seenSeq`. After N reconnects, the consumer had N copies of every frame.

**Fix.** Consumer-side dedup by JSON fingerprint of the raw event. Terminal events (`AnswerFailed`/`CompileFinished`) flip state but skip the events-array push when seen — replay must not fire `AnswerFailed` twice.

```ts
// apps/web/src/lib/use-event-stream.ts
const seenFingerprints = new Set<string>();
const fp = JSON.stringify(raw);
const isDuplicate = seenFingerprints.has(fp);
if (!isDuplicate) { seenFingerprints.add(fp); setEvents((prev) => [...prev, parsed]); }
```

**Lesson.** A clean fix would be a `since=<seq>` query param on the DO subscribe — but a wire-protocol change costs more than fingerprinting bought us. Sometimes the right fix is to make the consumer pretend the wire is at-most-once even when it's at-least-once.

---

## 5. Per-context port collision in the oRPC composition root

`e8d6ac5` · `apps/api/src/index.ts`

**Symptom.** `D1_TYPE_ERROR` from a CompileRunDO trying to call into a ChatTurnDO. Random tests passed; failures didn't repro consistently.

**Root cause.** Wiki, chat, and verification each define a port called `dispatcher`. Two also define `runs`; wiki and ingestion both define `sources`. The composition root spread all four contexts into one object — every handler got whichever runtime was spread last. Whether you got the wiki dispatcher or the chat dispatcher depended on bundler import order.

**Fix.** Inspect the router slug per request and rebind colliding keys to the matching context. Also rename verification's port to `lintDispatcher` so it never participates in the `dispatcher` collision.

```ts
// apps/api/src/index.ts
const slug = new URL(c.req.raw.url).pathname.match(/^\/rpc\/([^/]+)\//)?.[1];
const context = {
  ...wiki, ...chat, ...verification, ...ingestion,
  ...(slug === 'wiki' ? { dispatcher: wiki.dispatcher, runs: wiki.runs, sources: wiki.sources } : {}),
  ...(slug === 'chat' ? { dispatcher: chat.dispatcher } : {}),
};
```

**Lesson.** Generic port names — `dispatcher`, `runs`, `sources` — read fine in isolation and collide silently at the composition root. CLAUDE.md's "domains/X cannot import from domains/Y" is enforced statically; this is the dual rule for the composition root.

---

## 6. The "doesn't cover" hallucination — vocabulary gaps as content gaps

`b732265` · `packages/domains/chat/src/application/run-chat-turn.ts`

**Symptom.** User compiled a corpus under "Business Opportunities," got `Opportunity`/`Risk`/`Wedge` pages with rich bodies. Asked "what business opportunities are in this corpus?" Agent surfaced 20 pages. Synth replied: "findings appear empty."

**Root cause.** Compiled bodies use the source documents' vocabulary (AI-safety papers); titles and section markers use the perspective's vocabulary ("The Opportunity in One Line"). The synth saw body vocabulary, didn't see "business opportunity" verbatim, and over-fired the "wiki doesn't cover that" branch. It was treating a vocabulary gap as a content gap.

**Fix.** `SynthesizerInput` gains optional `wikiContext { perspective, pageTypes, folderName }`; `run-chat-turn` threads it from `WikiReader.getWikiMeta`. The system prompt gains a "doesn't cover trap" section with a concrete example: a page titled "Interpretability tools could become critical safety infrastructure" with body opening "## The Opportunity in One Line" IS an opportunity finding even when the body talks about alignment.

```ts
// packages/domains/chat/src/application/run-chat-turn.ts
const meta = await deps.wikiReader.getWikiMeta(args.wikiId);
const wikiContext = meta ? {
  ...(meta.perspective ? { perspective: meta.perspective } : {}),
  ...(meta.pageTypes.length > 0 ? { pageTypes: meta.pageTypes.map((pt) => pt.name) } : {}),
} : undefined;
```

**Lesson.** When user vocabulary and corpus vocabulary diverge, the synth needs to know the perspective is deliberate. "Doesn't cover" is for genuine domain mismatch (quantum chromodynamics vs cooking corpus) — an invariant the system prompt has to encode explicitly. Companion commit `1a48426` fixes the upstream symmetry: under a perspective, the Planner must assign 3+ PageType angles to every source, not one literal angle.

---

## 7. R2 key drift between writer and reader

`16304fc` · `apps/api/src/build-chat-context.ts`

**Symptom.** Every body the chat agent retrieved was empty. The synth still got something — source-text fragments — and reported "findings are empty fragments."

**Root cause.** A one-character bug. `DirectWikiReader` read R2 at `row.id`. The canonical writer (`createR2WikiPageStorage`) writes at `wiki_pages/<id>.md`. Reader and writer had different mental models of "where bodies live." `storage.get` returns `null` for a missing key, `obj?.text()` resolves to `''`, the prompt got body-less pages.

**Fix.**

```ts
// apps/api/src/build-chat-context.ts
const obj = await storage.get(`wiki_pages/${row.id}.md`);
```

**Lesson.** R2/S3 key conventions belong in one module — the writer's adapter. Every reader should import the key builder, not reconstruct the convention. Two readers diverging from one writer means the key is implicit; it should be a typed function with one home.

---

## 8. Slug collisions when bucketing pages by `(pageType, title)`

`798cf3d` · `packages/domains/wiki/src/application/compile-folder.ts`

**Symptom.** A 24-page-draft compile got to the final `insertMany` and rolled back. `UNIQUE(wiki_id, slug)` constraint violation.

**Root cause.** A prior commit (`5a18dbb`) widened drafting from "one call per PageType" to "one call per (PageType, title) bucket" — necessary to get 4 → 24 pages on a 10-paper corpus. But the Drafter slugs from title alone. "Alignment Faking in Large Language Models" appeared as a `Paper`, a `Phenomenon`, and a `Finding`; all three slugged identically. Slug derivation didn't see the pageType axis the bucketing introduced.

**Fix.** Per-compile slug deduper prefixes every slug with the pageType, suffixes `-2`, `-3`, … on within-pageType collisions, falls back to a UUID slice if 100+ collide.

```ts
// packages/domains/wiki/src/application/compile-folder.ts
const usedSlugs = new Set<string>();
const uniqueSlug = (pageType: string, baseSlug: string): string => {
  const ptSlug = pageType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stem = `${ptSlug}-${baseSlug}`;
  if (!usedSlugs.has(stem)) { usedSlugs.add(stem); return stem; }
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!usedSlugs.has(candidate)) { usedSlugs.add(candidate); return candidate; }
  }
  return `${stem}-${deps.newId().slice(0, 8)}`;
};
```

**Lesson.** When you widen the input space of a downstream step (more buckets → more drafts), audit every identity field that step depends on. A slug unique under "1 draft per PageType" is not unique under "1 draft per (PageType, title)."

---

## 9. The Narrator step silently overwrote its own output

`9b35c5a` · `packages/domains/wiki/src/application/compile-folder.ts`

**Symptom.** Narrator pass succeeded; thesis + glossary visible in D1 mid-compile. At end of run, same row had no thesis. No error.

**Root cause.** The Narrator updated D1 but the in-memory `const wiki` was stale. Later, `Wiki.recordCompile(wiki, …)` spread `wiki.schema` into the final persisted record — silently overwriting the thesis/glossary row the Narrator had just written. A read/modify/write race against itself.

**Fix.** Switch `wiki` to `let` and reassign after the Narrator step so the final `recordCompile` carries the enriched schema.

```ts
// packages/domains/wiki/src/application/compile-folder.ts
let wiki = Wiki.create({ id: wid, folderId: input.folderId, schema, createdAt: ... });
if (narrative) {
  const enriched = { ...wiki.schema, thesis: narrative.thesis, glossary: narrative.glossary };
  wiki = Wiki.create({ id: wiki.id, folderId: wiki.folderId, schema: enriched, createdAt: wiki.createdAt });
  await deps.wikis.update(wiki);
}
```

**Lesson.** An orchestrator that re-persists "the latest state of the aggregate" from a local snapshot is one missing reassignment away from a write-then-overwrite. Every D1 write must be reflected in the local that's eventually re-persisted.

---

## 10. Bare `Error` thrown through oRPC → generic 500 in the UI

`0f8d9f2` + `18069ed` · `packages/domains/ingestion/src/interface/index.ts`

**Symptom.** Deployed home page returned generic 500. `DriveFolderPicker` never flipped to "Sign in to Drive."

**Root cause.** `listFolders` threw a bare `new Error("No Drive tokens — call ingestion.authStart first.")`. oRPC's default `onError` scrubs untyped errors to `"Internal server error"` before they reach the client. The frontend's `isDriveAuthError` regex matched on the original message — the message never traveled.

**Fix.** Wrap the handler so the no-tokens error family maps to a typed `ORPCError('UNAUTHORIZED')`. Anything else propagates.

```ts
// packages/domains/ingestion/src/interface/index.ts
listFolders: os.listFolders.handler(async ({ context, input }) => {
  try { return await listDriveFolders(context, input); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/No Drive tokens|OAuthTokenUnreadable|drive_unauthorized|401/i.test(msg)) {
      throw new ORPCError('UNAUTHORIZED', { message: 'No Drive tokens — sign in to Drive first.' });
    }
    throw err;
  }
}),
```

**Lesson.** **The interface layer is the only place that turns domain errors into transport errors.** Every recoverable error needs a typed `ORPCError` code (`UNAUTHORIZED`, `PRECONDITION_FAILED`) at the interface boundary, plus a UI heuristic that matches the *code*, not the *message*.

---

## 11. wrangler ProxyWorker IPC breaks under bun-as-node

`1c92261` · `.nvmrc`, `scripts/setup`

**Symptom.** `curl localhost:8787` hung. A minimal Worker (`workerd serve config.capnp` outside the repo) responded fine.

**Root cause.** Wrangler 4 runs two workerds — a public ProxyWorker on `:8787` and a UserWorker on a random port. The UserWorker answered in 6ms; the ProxyWorker hung forwarding to its controller. The controller communicates over Node's IPC channel (`stdio: ipc` on fd 3). When `bunx` runs wrangler's `#!/usr/bin/env node` shim, Bun's shebang interception runs it under Bun. Bun's Node IPC compatibility differs subtly — TCP handshakes complete, no dispatch arrives, curl hangs.

**Fix.** Pin Node 22, verify it during setup, document the gotcha.

```bash
# scripts/setup
if [ -f "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; nvm use 2>/dev/null || true; fi
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[setup] Node ≥ 22 required for wrangler IPC."; exit 1
fi
```

**Lesson.** "Use Bun for everything" is wrong for any tool that uses Node IPC under the hood. **Diagnose by bypassing layers, not by reading the symptom literally** — when curl hangs and a minimal workerd works, the bug is between the Worker and the dev shell, not in workerd.

---

## 12. `useQuery` options evaluated in render hit the TDZ on a ref declared below

`4acc019` · `apps/web/src/routes/ingest.tsx`

**Symptom.** `IngestRoute` rendered, then threw `ReferenceError: Cannot access 'hasIngestResolved' before initialization`.

**Root cause.** `useQuery`'s options — including `refetchInterval` — are evaluated synchronously during render. The `sources` query dereferenced `hasIngestResolved.current`; the `useRef` lived a dozen lines below. `const` declarations sit in the temporal dead zone until their initializer runs.

**Fix.** Move refs and local state above the queries.

```tsx
// apps/web/src/routes/ingest.tsx
const hasIngestResolved = useRef(false);   // moved above sources query
const [phase, setPhase] = useState<'ingesting' | 'compiling' | 'error'>('ingesting');

const sources = useQuery({
  ...orpc.ingestion.listSources.queryOptions({ input: { folderId } }),
  refetchInterval: () => hasIngestResolved.current ? false : 1500,
});
```

**Lesson.** Anything a hook's option object reads is evaluated *now*, not *when the callback fires*. Treat a render function body the way you'd treat a module: declare before use, even when the use looks delayed.

---

## Themes

Bugs 1, 7, and 9 are the same shape — two ends of a boundary disagreeing about a contract that wasn't written down (citation hash, R2 key, in-memory aggregate state). Bugs 2 and 4 are LLM-SDK and SSE-wire idiosyncrasies that don't show up in a single-machine test. Bugs 3 and 5 are composition-root surprises in a multi-context monorepo. Bug 6 is the only one whose root cause is a prompt; the rest are code.

If you take one thing: **typed-citation systems live or die by the identity of the span**. The hash, the byte range, the source id, and the R2 key all have to agree at every boundary they cross. We earned that lesson three separate times before encoding it.
