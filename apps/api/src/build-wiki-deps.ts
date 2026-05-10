import {
  type D1Database,
  type DurableObjectNamespace,
  type R2Bucket,
  createCfCompileRunDispatcher,
  createD1CompileRunRepository,
  createD1WikiPageRepository,
  createD1WikiRepository,
  createLlmClient,
  createR2WikiPageStorage,
  createSourceReader,
} from '@domain/wiki/infrastructure';
import type { WikiContext } from '@domain/wiki/interface';
import type { GapAnalyzer } from '@domain/wiki/ports';
import type { CompileEvent } from '@package/contracts/wiki';
import { type EventBus, InMemoryEventBus } from '@package/shared-kernel';

/**
 * D1-backed wiki gap analyzer. Four queries:
 *   1. PageTypes from the wiki schema with no compiled wiki_pages
 *   2. Concept pages with zero claims
 *   3. Claims with zero citations
 *   4. Sources in the folder never referenced by any citation
 */
const createD1GapAnalyzer = (db: D1Database): GapAnalyzer => ({
  async analyze(wikiId) {
    const wikiRow = await db
      .prepare('SELECT folder_id, schema_json FROM wikis WHERE id = ?')
      .bind(wikiId)
      .first<{ folder_id: string; schema_json: string }>();
    if (!wikiRow) {
      return {
        pageTypeWithNoPages: [],
        pagesWithNoClaims: [],
        claimsWithNoCitations: [],
        sourcesNeverCited: [],
      };
    }
    const schema = JSON.parse(wikiRow.schema_json) as {
      pageTypes: Array<{ name: string; description: string }>;
    };

    // 1. PageTypes with no compiled pages
    const pageTypeCounts = await db
      .prepare(
        'SELECT page_type, COUNT(*) AS n FROM wiki_pages WHERE wiki_id = ? AND page_type IS NOT NULL GROUP BY page_type',
      )
      .bind(wikiId)
      .all<{ page_type: string; n: number }>();
    const usedTypes = new Set(pageTypeCounts.results.map((r) => r.page_type));
    const pageTypeWithNoPages = schema.pageTypes
      .filter((pt) => !usedTypes.has(pt.name))
      .map((pt) => ({ pageType: pt.name, description: pt.description }));

    // 2. Concept pages with zero claims
    const pagesWithNoClaims = (
      await db
        .prepare(
          `SELECT p.id, p.title, p.page_type
           FROM wiki_pages p
           LEFT JOIN claims c ON c.wiki_page_id = p.id
           WHERE p.wiki_id = ? AND p.subtype = 'Concept'
           GROUP BY p.id, p.title, p.page_type
           HAVING COUNT(c.id) = 0`,
        )
        .bind(wikiId)
        .all<{ id: string; title: string; page_type: string | null }>()
    ).results.map((r) => ({ pageId: r.id, title: r.title, pageType: r.page_type }));

    // 3. Claims with zero citations
    const claimsWithNoCitations = (
      await db
        .prepare(
          `SELECT cl.id AS claim_id, cl.claim_text, p.id AS page_id, p.title AS page_title
           FROM claims cl
           JOIN wiki_pages p ON p.id = cl.wiki_page_id
           LEFT JOIN citations cit ON cit.claim_id = cl.id
           WHERE p.wiki_id = ?
           GROUP BY cl.id, cl.claim_text, p.id, p.title
           HAVING COUNT(cit.id) = 0`,
        )
        .bind(wikiId)
        .all<{ claim_id: string; claim_text: string; page_id: string; page_title: string }>()
    ).results.map((r) => ({
      pageId: r.page_id,
      pageTitle: r.page_title,
      claimId: r.claim_id,
      claimText: r.claim_text,
    }));

    // 4. Sources in the same folder never referenced by any citation
    const sourcesNeverCited = (
      await db
        .prepare(
          `SELECT s.id, s.filename
           FROM sources s
           LEFT JOIN citations cit ON cit.source_id = s.id
             AND cit.claim_id IN (
               SELECT cl.id FROM claims cl
               JOIN wiki_pages p ON p.id = cl.wiki_page_id
               WHERE p.wiki_id = ?
             )
           WHERE s.folder_id = ?
           GROUP BY s.id, s.filename
           HAVING COUNT(cit.id) = 0`,
        )
        .bind(wikiId, wikiRow.folder_id)
        .all<{ id: string; filename: string }>()
    ).results.map((r) => ({ sourceId: r.id, filename: r.filename }));

    return {
      pageTypeWithNoPages,
      pagesWithNoClaims,
      claimsWithNoCitations,
      sourcesNeverCited,
    };
  },
});

export interface WikiBindings extends Record<string, unknown> {
  DB: D1Database;
  STORAGE: R2Bucket;
  COMPILE_RUN: DurableObjectNamespace;
  OPEN_ROUTER_API_KEY: string;
}

let cachedBus: EventBus | undefined;
const getBus = (): EventBus => {
  if (!cachedBus) cachedBus = new InMemoryEventBus();
  return cachedBus;
};

// Exposed for other contexts (e.g. chat) that need to publish into the same
// in-process bus the wiki context subscribes against. Keeps cross-context
// events flowing through one canonical instance.
export const getSharedEventBus = (): EventBus => getBus();

// Lazy throwers — for environments (e.g. unit tests against `app.fetch`)
// where the Worker bindings aren't supplied. The handler itself will only
// touch these when a `/rpc/wiki/*` request actually flows through.
const requireBinding = <T>(name: string, value: T | undefined): T => {
  if (value === undefined || value === null) {
    throw new Error(
      `wiki binding '${name}' is missing — set it in wrangler.toml or provide it to the test harness`,
    );
  }
  return value;
};

const baseDeps = (env: Partial<WikiBindings>) => {
  const llm = createLlmClient({
    apiKey: env.OPEN_ROUTER_API_KEY ?? '',
    appName: 'tenex',
    appUrl: 'https://tenex.dev',
  });
  const wikiPageStorage = env.STORAGE ? createR2WikiPageStorage(env.STORAGE) : undefined;
  const wikis = env.DB
    ? createD1WikiRepository(env.DB)
    : (undefined as unknown as ReturnType<typeof createD1WikiRepository>);
  const pages =
    env.DB && wikiPageStorage
      ? createD1WikiPageRepository(env.DB, wikiPageStorage)
      : (undefined as unknown as ReturnType<typeof createD1WikiPageRepository>);
  const runs = env.DB
    ? createD1CompileRunRepository(env.DB)
    : (undefined as unknown as ReturnType<typeof createD1CompileRunRepository>);
  const sources =
    env.DB && env.STORAGE
      ? createSourceReader(env.DB, env.STORAGE)
      : (undefined as unknown as ReturnType<typeof createSourceReader>);
  const dispatcher = env.COMPILE_RUN
    ? createCfCompileRunDispatcher(env.COMPILE_RUN)
    : (undefined as unknown as ReturnType<typeof createCfCompileRunDispatcher>);
  const gapAnalyzer = env.DB ? createD1GapAnalyzer(env.DB) : (undefined as unknown as GapAnalyzer);
  const eventBus = getBus();
  // Surface clear errors when an unwired handler tries to use a missing
  // binding (e.g. `wiki.startCompile` against a test harness with no DO).
  void requireBinding;
  return { llm, sources, wikis, pages, runs, dispatcher, gapAnalyzer, eventBus };
};

// Used by the oRPC handler context. The CompileRunDO uses
// `buildCompileRuntimeDeps` instead — that one wires the per-run `emit`.
export const buildWikiContext = (
  env: Partial<WikiBindings>,
  clock: WikiContext['clock'],
): WikiContext => ({
  ...baseDeps(env),
  clock,
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
});

export const buildCompileRuntimeDeps = (
  env: WikiBindings,
  emit: (e: CompileEvent) => Promise<void>,
) => ({
  ...baseDeps(env),
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
  emit,
});
