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

const groupBy = <T, K>(items: T[], by: (t: T) => K): Map<K, T[]> => {
  const m = new Map<K, T[]>();
  for (const i of items) {
    const k = by(i);
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return m;
};

const ensureContentHash = (raw: string): ContentHash => {
  // The SourceReader already provides a content hash from ingestion; default
  // for tests/fixtures where it's missing keeps the type contract honest.
  if (/^[a-z0-9]+:[a-f0-9]+$/.test(raw)) return raw as ContentHash;
  return `sha256:${raw
    .padStart(64, '0')
    .slice(0, 64)
    .replace(/[^a-f0-9]/g, '0')}` as ContentHash;
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
    const { schema, reason } = await inferSchema({ llm: deps.llm }, { sources: headTexts });
    await deps.emit({
      kind: 'SchemaInferred',
      compileRunId: input.compileRunId,
      schema,
      reason,
    });

    // 2. Wiki record --------------------------------------------------------
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

    const findingsBySource = await Promise.all(
      tasks.map(async (t): Promise<EnrichedFinding[]> => {
        const src = allTexts.find((s) => s.sourceId === t.sourceId);
        if (!src) return [];
        const { findings } = await researchSource(
          { llm: deps.llm },
          { source: src, pageTypes: t.pageTypes },
        );
        return findings.map((f) => ({
          ...f,
          sourceId: src.sourceId,
          sourceFilename: src.filename,
          sourceText: src.text,
          sourceContentHash: ensureContentHash(src.contentHash),
        }));
      }),
    );
    const allFindings: EnrichedFinding[] = findingsBySource.flat();

    // 5. Draft per (PageType, title) bucket --------------------------------
    run = CompileRun.advance(run, 'drafting', deps.now().toISOString());
    await deps.runs.update(run);

    const conceptDrafts: ConceptPage[] = [];
    for (const pt of schema.pageTypes) {
      const findingsOfType = allFindings.filter((f) => f.pageType === pt.name);
      if (findingsOfType.length === 0) continue;
      const grouped = groupBy(findingsOfType, (f) => f.title.trim().toLowerCase());
      for (const [, findings] of grouped) {
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
        const { draft } = await draftPage(
          { llm: deps.llm },
          { pageType: pt.name, findings: draftFindings },
        );

        const pid = parseWikiPageId(deps.newId());
        const claims: Claim[] = draft.claims.map((c, claimIdx) => {
          const claimUuid = parseClaimId(deps.newId());
          const citations: Citation[] = c.citations.map((cit, _citIdx) => ({
            id: parseCitationId(deps.newId()),
            label: cit.label,
            span: {
              sourceId: cit.sourceId,
              byteRange: { start: cit.spanStart, end: Math.max(cit.spanEnd, cit.spanStart + 1) },
              contentHash: cit.sourceContentHash,
            },
          }));
          return {
            id: claimUuid,
            wikiPageId: pid,
            paragraphId: c.paragraphId || `p-${claimIdx + 1}`,
            claimText: c.claimText,
            citations,
          };
        });

        const conceptPage = WikiPage.concept({
          id: pid,
          wikiId: wid,
          pageType: pt.name,
          slug: draft.slug,
          title: draft.title,
          body: draft.body,
          claims,
          updatedAt: deps.now().toISOString(),
        });
        conceptDrafts.push(conceptPage);

        await deps.emit({
          kind: 'PageDrafted',
          compileRunId: input.compileRunId,
          pageId: pid,
          subtype: 'Concept',
          pageType: pt.name,
          title: draft.title,
        });
      }
    }

    // 6. Link --------------------------------------------------------------
    run = CompileRun.advance(run, 'linking', deps.now().toISOString());
    await deps.runs.update(run);

    const { backlinks, arityErrors } = resolveBacklinks(conceptDrafts, schema.relations);
    if (arityErrors.length > 0) {
      // Cardinality violations log a warning but don't fail the compile —
      // they're surfaced to the verification context via Claims later.
      console.warn('[wiki] backlink arity warnings', arityErrors);
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

    const { indexPages } = buildIndexes({
      wikiId: wid,
      pages: conceptsWithLinks,
      pageTypes: schema.pageTypes.map((p) => p.name),
      newId: deps.newId,
      now: deps.now,
    });
    for (const ip of indexPages) {
      await deps.emit({
        kind: 'IndexBuilt',
        compileRunId: input.compileRunId,
        pageType: ip.pageType,
        pageCount: ip.entries.length,
      });
    }

    await deps.pages.insertMany([...conceptsWithLinks, ...indexPages] as Array<
      ConceptPage | IndexPage
    >);

    // 8. Finalize ----------------------------------------------------------
    const endedAt = deps.now().toISOString();
    run = CompileRun.finish(run, { wikiId: wid, endedAt });
    await deps.runs.update(run);
    const totalPages = conceptsWithLinks.length + indexPages.length;
    const finalWiki = Wiki.recordCompile(wiki, endedAt, totalPages);
    await deps.wikis.update(finalWiki);

    await deps.emit({
      kind: 'CompileFinished',
      compileRunId: input.compileRunId,
      wikiId: wid,
      pageCount: totalPages,
    });

    await deps.eventBus.publish({
      name: 'CompileFinished',
      occurredAt: endedAt,
      payload: {
        compileRunId: input.compileRunId,
        wikiId: wid,
        pageCount: totalPages,
      },
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
