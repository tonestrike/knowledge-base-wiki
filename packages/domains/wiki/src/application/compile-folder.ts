import {
  type Citation,
  type Claim,
  type CompileRunId,
  type ContentHash,
  type FolderId,
  type SourceId,
  type WikiId,
  type WikiPageId,
  citationId as parseCitationId,
  claimId as parseClaimId,
  wikiId as parseWikiId,
  wikiPageId as parseWikiPageId,
} from '@package/contracts/shared';
import { CompileRun, type CompileRun as TCompileRun } from '../domain/compile-run.ts';
import { type ConceptPage, type IndexPage, WikiPage } from '../domain/wiki-page.ts';
import { Wiki } from '../domain/wiki.ts';
import { buildIndexes } from './build-indexes.ts';
import { type ResearchFinding, draftPage } from './draft-page.ts';
import { inferSchema } from './infer-schema.ts';
import { narrateIndexes } from './narrate-indexes.ts';
import { planCompile } from './plan-compile.ts';
import type { CompileRuntimeDeps, ExtractedSourceText } from './ports.ts';
import { researchSource } from './research-source.ts';
import { resolveBacklinks } from './resolve-backlinks.ts';

type EnrichedFinding = {
  pageType: string;
  title: string;
  evidence: string;
  spanStart: number;
  spanEnd: number;
  sourceId: SourceId;
  sourceFilename: string;
  sourceText: string;
  sourceContentHash: ContentHash;
};

// SF11 — content hashes are load-bearing for the verification context's
// span check. Silently padding zeros to fake a hash on regex mismatch
// would mean spans pass verification against a synthesized hash that
// doesn't match the actual source bytes. Throw instead so the orchestrator
// turns bad upstream data into a CompileFailed event.
const ensureContentHash = (raw: string): ContentHash => {
  if (/^[a-z0-9]+:[a-f0-9]+$/.test(raw)) return raw as ContentHash;
  throw new Error(
    `invalid contentHash from SourceReader: ${JSON.stringify(raw)} (expected "<algo>:<hex>")`,
  );
};

// Citations carry the hash of the *slice* their byteRange covers, not the
// whole-source hash — chat's SourceHashVerifier re-hashes `text.slice(start,
// end)` and compares. Storing the source's whole-file hash here would make
// every citation tripwire at chat time. Web Crypto is portable across Bun
// (tests) and workerd (prod).
const sliceHash = async (text: string, start: number, end: number): Promise<ContentHash> => {
  const slice = text.slice(start, end);
  const bytes = new TextEncoder().encode(slice);
  // Copy into a fresh ArrayBuffer; Bun's strict types reject a bare
  // Uint8Array<ArrayBufferLike> for `crypto.subtle.digest`.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', ab);
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}` as ContentHash;
};

export async function compileFolder(
  deps: CompileRuntimeDeps,
  input: { compileRunId: CompileRunId; folderId: FolderId },
): Promise<{ wikiId: WikiId }> {
  const startedAt = deps.now().toISOString();
  let run: TCompileRun = CompileRun.start({
    id: input.compileRunId,
    folderId: input.folderId,
    startedAt,
  });
  await deps.runs.insert(run);

  try {
    const sourceList = await deps.sources.list(input.folderId);
    if (sourceList.length === 0) {
      throw new Error(`Folder ${input.folderId} has no sources to compile`);
    }

    await deps.emit({
      kind: 'CompileStarted',
      compileRunId: input.compileRunId,
      folderId: input.folderId,
      sourceCount: sourceList.length,
    });

    // Pipeline-narrated checkpoints (`AgentThought`). These are deterministic
    // template strings — zero LLM cost — that surface in the CompileTheater's
    // Agents lane so the user sees what the orchestrator is doing right now.
    // The typed events (CompileStarted / SchemaInferred / PageDrafted / …)
    // still fire on their own and drive the Sources / Pages lanes.
    const thought = (
      agent: 'Compiler' | 'SchemaInferrer' | 'Researcher' | 'Drafter' | 'Linker' | 'IndexBuilder',
      message: string,
    ) =>
      deps.emit({
        kind: 'AgentThought',
        compileRunId: input.compileRunId,
        agent,
        message,
      });

    await thought(
      'Compiler',
      `Reading ${sourceList.length} source${sourceList.length === 1 ? '' : 's'} from the folder…`,
    );

    // 1. Schema inference (read first 10 sources) ---------------------------
    run = CompileRun.advance(run, 'inferring-schema', deps.now().toISOString());
    await deps.runs.update(run);

    const headSlice = sourceList.slice(0, 10);
    const headTexts: ExtractedSourceText[] = [];
    for (const s of headSlice) {
      const r = await deps.sources.read(s.sourceId);
      if (!r) throw new Error(`Source not readable: ${s.sourceId}`);
      headTexts.push(r);
    }
    await thought(
      'SchemaInferrer',
      `Inferring schema from the first ${headTexts.length} source${headTexts.length === 1 ? '' : 's'}…`,
    );
    const { schema, reason } = await inferSchema({ llm: deps.llm }, { sources: headTexts });
    await deps.emit({
      kind: 'SchemaInferred',
      compileRunId: input.compileRunId,
      schema,
      reason,
    });
    await thought(
      'SchemaInferrer',
      `Schema settled: ${schema.pageTypes.length} PageType${schema.pageTypes.length === 1 ? '' : 's'}, ${schema.relations.length} relation${schema.relations.length === 1 ? '' : 's'}.`,
    );

    // 2. Wiki record --------------------------------------------------------
    // The `wikis` table has UNIQUE(folder_id), so a re-compile against a
    // folder that already has a wiki would 500 with a raw D1 constraint
    // error. Detect that case up-front and throw a recoverable message
    // instead — the dispatcher reshapes it into a CompileFailed event,
    // and the operator can drop the existing wiki via D1 before retrying.
    // (A "delete wiki" UI / repo method is the right long-term fix.)
    const existingWiki = await deps.wikis.findByFolderId(input.folderId);
    if (existingWiki) {
      throw new Error(
        `Folder ${input.folderId} already has a compiled wiki (id=${existingWiki.id}). Delete it before re-compiling.`,
      );
    }
    const wid = parseWikiId(deps.newId());
    const wiki = Wiki.create({
      id: wid,
      folderId: input.folderId,
      schema,
      createdAt: deps.now().toISOString(),
    });
    await deps.wikis.insert(wiki);

    // 3. Plan ---------------------------------------------------------------
    run = CompileRun.advance(run, 'planning', deps.now().toISOString());
    await deps.runs.update(run);

    // Read the rest of the sources we haven't already loaded.
    const tail = sourceList.slice(headTexts.length);
    const tailTexts: ExtractedSourceText[] = [];
    for (const s of tail) {
      const r = await deps.sources.read(s.sourceId);
      if (!r) throw new Error(`Source not readable: ${s.sourceId}`);
      tailTexts.push(r);
    }
    const allTexts = [...headTexts, ...tailTexts];
    const { tasks } = await planCompile({ llm: deps.llm }, { schema, sources: allTexts });

    // 4. Research (concurrent) ---------------------------------------------
    run = CompileRun.advance(run, 'researching', deps.now().toISOString());
    await deps.runs.update(run);

    // SF1 — per-source isolation. allSettled keeps successful Researcher
    // findings even if other sources throw; each failure becomes a typed
    // ResearchFailed event so the user sees which source broke and why.
    console.info(
      `[compile-folder] dispatching ${tasks.length} Researcher tasks; allTexts ids: ${allTexts.map((s) => s.sourceId.slice(0, 8)).join(',')}; task ids: ${tasks.map((t) => t.sourceId.slice(0, 8)).join(',')}`,
    );
    // Sequential dispatch — OpenRouter throttles concurrent Haiku calls in
    // the demo tier; running 5 in parallel produced 4 "No object generated"
    // failures every time. Sequential is slower (~10s × N) but reliable.
    const settled: Array<
      PromiseSettledResult<{ sourceId: SourceId; findings: EnrichedFinding[] }>
    > = [];
    await thought(
      'Researcher',
      `Reading ${tasks.length} source${tasks.length === 1 ? '' : 's'} for findings…`,
    );
    for (const t of tasks) {
      try {
        const src = allTexts.find((s) => s.sourceId === t.sourceId);
        if (!src) {
          console.info(
            `[compile-folder] task sourceId=${t.sourceId.slice(0, 8)} NOT in allTexts — skipping`,
          );
          settled.push({
            status: 'fulfilled',
            value: { sourceId: t.sourceId, findings: [] },
          });
          continue;
        }
        await thought('Researcher', `Reading ${src.filename} for ${t.pageTypes.join(', ')}…`);
        const { findings } = await researchSource(
          { llm: deps.llm },
          { source: src, pageTypes: t.pageTypes },
        );
        settled.push({
          status: 'fulfilled',
          value: {
            sourceId: src.sourceId,
            findings: findings.map((f) => ({
              ...f,
              sourceId: src.sourceId,
              sourceFilename: src.filename,
              sourceText: src.text,
              sourceContentHash: ensureContentHash(src.contentHash),
            })),
          },
        });
      } catch (err) {
        settled.push({ status: 'rejected', reason: err });
      }
    }
    const allFindings: EnrichedFinding[] = [];
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      const t = tasks[i];
      if (!s || !t) continue;
      if (s.status === 'fulfilled') {
        allFindings.push(...s.value.findings);
      } else {
        const message = s.reason instanceof Error ? s.reason.message : String(s.reason);
        console.info(
          `[compile-folder] Researcher REJECTED for sourceId=${t.sourceId.slice(0, 8)}: ${message}`,
        );
        await deps.emit({
          kind: 'ResearchFailed',
          compileRunId: input.compileRunId,
          sourceId: t.sourceId,
          message,
        });
      }
    }

    // 5. Draft per (PageType, title) bucket --------------------------------
    run = CompileRun.advance(run, 'drafting', deps.now().toISOString());
    await deps.runs.update(run);

    const conceptDrafts: ConceptPage[] = [];

    // Bucket findings by (pageType, normalized title). A bucket becomes
    // ONE Concept page. Previous design collapsed across titles within
    // each pageType — turning 50 findings about 10 different papers into
    // a single "Paper" page. The user noticed the resulting wikis felt
    // thin (4 pages from 10 PDFs); this is why.
    //
    // Bound the total drafter call count at MAX_DRAFTS so a pathological
    // corpus (200+ findings) can't blow past the wall clock. Within each
    // pageType we keep the top buckets by finding count, then take a
    // round-robin pass across pageTypes so no single type starves the
    // others.
    const MAX_DRAFTS = 24;
    const MAX_PER_PAGETYPE = 8;
    const normTitle = (s: string): string =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    // Step 1: build a map<pageType, map<normalizedTitle, findings>>
    const byType = new Map<string, Map<string, EnrichedFinding[]>>();
    for (const f of allFindings) {
      const key = normTitle(f.title);
      if (!key) continue;
      let titleBuckets = byType.get(f.pageType);
      if (!titleBuckets) {
        titleBuckets = new Map();
        byType.set(f.pageType, titleBuckets);
      }
      const existing = titleBuckets.get(key) ?? [];
      existing.push(f);
      titleBuckets.set(key, existing);
    }

    // Step 2: within each pageType, keep top MAX_PER_PAGETYPE buckets by
    // size. Then round-robin across pageTypes to assemble the global
    // queue, capped at MAX_DRAFTS. Iteration order matches the schema's
    // pageTypes list so "Paper" / "Model" / etc. all get representation
    // even on very large corpora.
    const queuesPerType = schema.pageTypes
      .map((pt) => {
        const titleBuckets = byType.get(pt.name);
        if (!titleBuckets) return { pageType: pt.name, buckets: [] as EnrichedFinding[][] };
        const ranked = [...titleBuckets.values()]
          .sort((a, b) => b.length - a.length)
          .slice(0, MAX_PER_PAGETYPE);
        return { pageType: pt.name, buckets: ranked };
      })
      .filter((q) => q.buckets.length > 0);

    const dispatchQueue: Array<{ pageType: string; findings: EnrichedFinding[] }> = [];
    let idx = 0;
    while (dispatchQueue.length < MAX_DRAFTS && queuesPerType.some((q) => q.buckets.length > 0)) {
      const q = queuesPerType[idx % queuesPerType.length];
      if (q && q.buckets.length > 0) {
        const next = q.buckets.shift();
        if (next) dispatchQueue.push({ pageType: q.pageType, findings: next });
      }
      idx += 1;
    }

    console.info(
      `[compile-folder] drafting ${dispatchQueue.length} pages (${allFindings.length} findings across ${byType.size} pageTypes; cap=${MAX_DRAFTS})`,
    );
    await thought(
      'Drafter',
      `Drafting ${dispatchQueue.length} page${dispatchQueue.length === 1 ? '' : 's'} from ${allFindings.length} finding${allFindings.length === 1 ? '' : 's'} across ${byType.size} type${byType.size === 1 ? '' : 's'}…`,
    );

    // Step 3: parallel Drafter calls. OpenRouter's tier handles concurrent
    // streamObject calls fine for the Drafter prompt (much lighter than
    // Researcher); per-call `maxRetries: 1` keeps any individual flakiness
    // bounded. allSettled so one bad draft can't tank the whole compile.
    const draftWork = dispatchQueue.map(async (bucket) => {
      const { pageType, findings } = bucket;
      const draftFindings: ResearchFinding[] = findings.map((f) => ({
        sourceId: f.sourceId,
        sourceFilename: f.sourceFilename,
        sourceText: f.sourceText,
        sourceContentHash: f.sourceContentHash,
        evidence: f.evidence,
        spanStart: f.spanStart,
        spanEnd: f.spanEnd,
        title: f.title,
      }));
      const draftStart = Date.now();
      const { draft } = await draftPage({ llm: deps.llm }, { pageType, findings: draftFindings });
      console.info(
        `[compile-folder] Drafter done pageType=${pageType} in ${Date.now() - draftStart}ms slug=${draft.slug} title="${draft.title}"`,
      );

      const sourceTextById = new Map<SourceId, string>(
        findings.map((f) => [f.sourceId, f.sourceText]),
      );

      const pid = parseWikiPageId(deps.newId());
      const claims: Claim[] = await Promise.all(
        draft.claims.map(async (c, claimIdx) => {
          const claimUuid = parseClaimId(deps.newId());
          const citations: Citation[] = await Promise.all(
            c.citations.map(async (cit) => {
              const start = cit.spanStart;
              const end = Math.max(cit.spanEnd, cit.spanStart + 1);
              const text = sourceTextById.get(cit.sourceId);
              if (text == null) {
                throw new Error(
                  `citation references sourceId ${cit.sourceId} not present in findings for pageType=${pageType}`,
                );
              }
              return {
                id: parseCitationId(deps.newId()),
                label: cit.label,
                span: {
                  sourceId: cit.sourceId,
                  byteRange: { start, end },
                  contentHash: await sliceHash(text, start, end),
                },
              };
            }),
          );
          return {
            id: claimUuid,
            wikiPageId: pid,
            paragraphId: c.paragraphId || `p-${claimIdx + 1}`,
            claimText: c.claimText,
            citations,
          };
        }),
      );

      const conceptPage = WikiPage.concept({
        id: pid,
        wikiId: wid,
        pageType,
        slug: draft.slug,
        title: draft.title,
        body: draft.body,
        claims,
        updatedAt: deps.now().toISOString(),
      });

      await deps.emit({
        kind: 'PageDrafted',
        compileRunId: input.compileRunId,
        pageId: pid,
        subtype: 'Concept',
        pageType,
        title: draft.title,
      });
      return conceptPage;
    });

    const drafted = await Promise.allSettled(draftWork);
    for (const r of drafted) {
      if (r.status === 'fulfilled') {
        conceptDrafts.push(r.value);
      } else {
        console.warn(
          '[compile-folder] Drafter call failed; skipping page',
          r.reason instanceof Error ? r.reason.message : r.reason,
        );
      }
    }

    // 6. Link --------------------------------------------------------------
    run = CompileRun.advance(run, 'linking', deps.now().toISOString());
    await deps.runs.update(run);

    await thought('Linker', `Resolving backlinks across ${conceptDrafts.length} pages…`);
    const { backlinks: candidateBacklinks } = resolveBacklinks(conceptDrafts, schema.relations);
    // SF5 / TD1 — Wiki owns relation arity. Violations are dropped from the
    // Wiki and surfaced as typed events; they MUST NOT be persisted to D1
    // because the 2.D verification pass would treat them as findings.
    const { kept: backlinks, violations } = Wiki.addBacklinks(wiki, candidateBacklinks);
    for (const v of violations) {
      await deps.emit({
        kind: 'BacklinkArityViolated',
        compileRunId: input.compileRunId,
        fromPageId: v.backlink.fromPageId,
        toPageId: v.backlink.toPageId,
        relationName: v.relationName,
        cardinality: v.cardinality,
        reason: v.reason,
      });
    }
    const backlinksByFrom = new Map<WikiPageId, typeof backlinks>();
    for (const bl of backlinks) {
      backlinksByFrom.set(bl.fromPageId, [...(backlinksByFrom.get(bl.fromPageId) ?? []), bl]);
      await deps.emit({
        kind: 'BacklinkResolved',
        compileRunId: input.compileRunId,
        fromPageId: bl.fromPageId,
        toPageId: bl.toPageId,
        relationName: bl.relationName,
      });
    }
    // Re-attach backlinks to the concept drafts (immutable rebuild).
    const conceptsWithLinks: ConceptPage[] = conceptDrafts.map((p) =>
      WikiPage.concept({
        id: p.id,
        wikiId: p.wikiId,
        pageType: p.pageType,
        slug: p.slug,
        title: p.title,
        body: p.body,
        claims: [...p.claims],
        backlinks: [...(backlinksByFrom.get(p.id) ?? [])],
        updatedAt: p.updatedAt,
      }),
    );

    // 7. Index -------------------------------------------------------------
    run = CompileRun.advance(run, 'indexing', deps.now().toISOString());
    await deps.runs.update(run);

    // Opinionated narrator pass — replaces the deterministic
    // "This index lists every X" template with a 1-2 sentence
    // narrative about what each PageType contributes in *this* corpus.
    // Best-effort: if the narrator LLM call fails (rate limit, schema
    // rejection, network), we fall back to the schema description.
    const entriesByPageType: Record<string, Array<{ title: string; teaser?: string }>> = {};
    for (const p of conceptsWithLinks) {
      let list = entriesByPageType[p.pageType];
      if (!list) {
        list = [];
        entriesByPageType[p.pageType] = list;
      }
      const teaser = p.claims[0]?.claimText?.trim().slice(0, 160);
      list.push({ title: p.title, ...(teaser ? { teaser } : {}) });
    }
    let narrative: {
      thesis: string;
      pageTypeNarratives: Array<{ pageType: string; narrative: string }>;
      glossary: Array<{ term: string; definition: string }>;
    } | null = null;
    try {
      await thought('IndexBuilder', 'Drafting an opinionated narrative for each section…');
      narrative = await narrateIndexes({ llm: deps.llm }, { schema, entriesByPageType });
    } catch (err) {
      console.warn(
        '[compile-folder] narrate-indexes failed; falling back to deterministic intros',
        err instanceof Error ? err.message : err,
      );
    }

    // Stamp the thesis + glossary onto the wiki record so they can render
    // at the top of the overview page. Best-effort: skip the update if
    // narration failed.
    if (narrative) {
      const enrichedSchema = {
        ...wiki.schema,
        ...(narrative.thesis ? { thesis: narrative.thesis } : {}),
        ...(narrative.glossary.length > 0 ? { glossary: narrative.glossary } : {}),
      };
      await deps.wikis.update(
        Wiki.create({
          id: wiki.id,
          folderId: wiki.folderId,
          schema: enrichedSchema,
          createdAt: wiki.createdAt,
        }),
      );
    }

    const pageTypeDescriptions: Record<string, string> = {};
    for (const pt of schema.pageTypes) {
      const narratedIntro = narrative?.pageTypeNarratives.find((n) => n.pageType === pt.name);
      pageTypeDescriptions[pt.name] = narratedIntro?.narrative ?? pt.description;
    }
    const { indexPages } = buildIndexes({
      wikiId: wid,
      pages: conceptsWithLinks,
      pageTypes: schema.pageTypes.map((p) => p.name),
      pageTypeDescriptions,
      newId: deps.newId,
      now: deps.now,
    });
    await thought(
      'Linker',
      `Resolved ${backlinks.length} backlink${backlinks.length === 1 ? '' : 's'}${
        violations.length > 0 ? `; dropped ${violations.length} arity violation(s)` : ''
      }.`,
    );
    for (const ip of indexPages) {
      await deps.emit({
        kind: 'IndexBuilt',
        compileRunId: input.compileRunId,
        pageType: ip.pageType,
        pageCount: ip.entries.length,
      });
      await thought(
        'IndexBuilder',
        `Indexed ${ip.pageType} (${ip.entries.length} page${ip.entries.length === 1 ? '' : 's'}).`,
      );
    }

    // Structural guard (TD2): every drafted page must declare a pageType
    // that's in the wiki's schema. The Drafter is constrained by prompt to
    // pick from `schema.pageTypes`, but a structural assertion here makes
    // that invariant load-bearing — drift surfaces as a thrown error
    // (which the outer try/catch turns into a CompileFailed event) rather
    // than silently inserting a page that no schema-filtered query can
    // return.
    for (const p of [...conceptsWithLinks, ...indexPages]) {
      Wiki.assertPageTypeKnown(wiki, p);
    }

    await deps.pages.insertMany([...conceptsWithLinks, ...indexPages] as Array<
      ConceptPage | IndexPage
    >);

    // 8. Finalize ----------------------------------------------------------
    // SF3 — publish-first / mark-finished-after.
    // Pages are already persisted to R2+D1 above. We now (a) publish the
    // cross-context CompileFinished event, then (b) mark the run + wiki
    // finished. If the cross-context publish throws, the outer catch sees
    // the failure and the run is recorded as failed instead of silently
    // persisting "finished" with downstream contexts (e.g. 2.D verification)
    // never having received the notification. Once the run is marked
    // finished, both the SSE tape emit and the bus publish have already
    // happened — making this section idempotent on a retry (re-issuing
    // CompileFinished against an already-finished run is a no-op for any
    // handler that dedupes on compileRunId).
    const endedAt = deps.now().toISOString();
    const totalPages = conceptsWithLinks.length + indexPages.length;

    await deps.eventBus.publish({
      name: 'CompileFinished',
      occurredAt: endedAt,
      payload: {
        compileRunId: input.compileRunId,
        wikiId: wid,
        finishedAt: endedAt,
        pageCount: totalPages,
      },
    });

    run = CompileRun.finish(run, { wikiId: wid, endedAt });
    await deps.runs.update(run);
    const finalWiki = Wiki.recordCompile(wiki, endedAt, totalPages);
    await deps.wikis.update(finalWiki);

    await thought(
      'Compiler',
      `Compile finished — ${totalPages} page${totalPages === 1 ? '' : 's'}.`,
    );
    await deps.emit({
      kind: 'CompileFinished',
      compileRunId: input.compileRunId,
      wikiId: wid,
      pageCount: totalPages,
    });

    return { wikiId: wid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = deps.now().toISOString();
    const failed = CompileRun.fail(run, message, failedAt);
    await deps.runs.update(failed);
    await deps.emit({
      kind: 'CompileFailed',
      compileRunId: input.compileRunId,
      message,
    });
    throw err;
  }
}
