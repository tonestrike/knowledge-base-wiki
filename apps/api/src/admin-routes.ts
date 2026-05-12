import { createOpenRouterEmbedder, createVectorWikiReader, indexWiki } from '@domain/chat';
import type { WikiId } from '@package/contracts/shared';
import type { VectorizeIndex } from '@package/shared-kernel';
import type { Hono } from 'hono';
import { resolveSession } from './session.ts';

/**
 * Bindings the admin reindex endpoint needs. Distinct from `Env` in
 * `index.ts` so the route module stays decoupled from the rest of the
 * Worker's surface — it can be lifted out wholesale.
 */
interface AdminEnv {
  ENVIRONMENT?: string;
  DB: D1Database;
  STORAGE: R2Bucket;
  VECTORIZE?: VectorizeIndex;
  OPEN_ROUTER_API_KEY?: string;
  SESSION_SIGNING_KEY?: string;
}

/**
 * Resolve the caller's session. Returns the UserId for a valid signed
 * `tenex_sid` cookie, or `null` for anonymous / forged callers. In the
 * test environment we short-circuit to the fixed test user id so
 * integration tests can hit the admin endpoint without provisioning a
 * signing key.
 */
const requireSession = async (request: Request, env: AdminEnv): Promise<string | null> => {
  return resolveSession({
    cookieHeader: request.headers.get('cookie'),
    ...(env.SESSION_SIGNING_KEY ? { signingKeyBase64: env.SESSION_SIGNING_KEY } : {}),
    environment: env.ENVIRONMENT,
  });
};

/**
 * Mount the admin-only `/__admin/*` routes. Unlike `/__dev/*` these are
 * available in production — they're gated by the session cookie, so any
 * signed-in operator can hit them but anonymous traffic can't. The
 * "admin" prefix is a soft hint; the real boundary is the cookie check.
 *
 * Today there's one route:
 *
 * - `POST /__admin/reindex-wiki/:wikiId`
 *     Walks a wiki, embeds every page + every cited source, upserts
 *     into Vectorize. Used to backfill the index for wikis that were
 *     compiled before auto-indexing was wired (or to recover after a
 *     Vectorize index recreate). Logs each upsert via `console.info`
 *     so `wrangler tail` shows progress per-vector.
 */
// biome-ignore lint/suspicious/noExplicitAny: app is generic over its Bindings
export const mountAdminRoutes = (app: Hono<any>): void => {
  app.post('/__admin/reindex-wiki/:wikiId', async (c) => {
    const env = (c.env ?? {}) as AdminEnv;
    const userId = await requireSession(c.req.raw, env);
    if (!userId) {
      return c.json({ error: 'session required' }, 401);
    }
    if (!env.DB || !env.STORAGE) {
      return c.json({ error: 'D1/R2 bindings missing' }, 500);
    }
    if (!env.VECTORIZE) {
      return c.json({ error: 'VECTORIZE binding not configured' }, 503);
    }
    if (!env.OPEN_ROUTER_API_KEY) {
      return c.json({ error: 'OPEN_ROUTER_API_KEY not configured' }, 503);
    }

    const wikiIdRaw = c.req.param('wikiId');
    if (!wikiIdRaw) return c.json({ error: 'wikiId path param is required' }, 400);
    const wikiId = wikiIdRaw as WikiId;

    // We don't reuse the chat-context's `VectorWikiReader` here because
    // that one is closed over a singleton bus. The reindex walk doesn't
    // care about the bus — it just calls `indexSource` / `indexWikiPage`
    // directly. Construct a fresh reader so we can run cleanly even if
    // the chat context hasn't been built yet on this isolate.
    const vectorReader = createVectorWikiReader({
      db: env.DB,
      storage: env.STORAGE,
      vectorize: env.VECTORIZE,
      embedder: createOpenRouterEmbedder({ apiKey: env.OPEN_ROUTER_API_KEY }),
      // The `inner` fallback is unused for the indexing path; supply a
      // no-op so the wrapper stays constructable without wiring the
      // full D1 reader here.
      inner: {
        async searchPages() {
          return [];
        },
        async listSamplePages() {
          return [];
        },
        async getPage() {
          return null;
        },
        async searchSources() {
          return [];
        },
        async listPagesByType() {
          return [];
        },
        async getWikiMeta() {
          return null;
        },
      },
    });

    console.info('[admin.reindex-wiki] start wikiId=%s userId=%s', wikiId, userId);
    const result = await indexWiki({ vectorReader, db: env.DB, storage: env.STORAGE }, wikiId);
    console.info(
      '[admin.reindex-wiki] done wikiId=%s pagesIndexed=%d sourcesIndexed=%d errors=%d',
      wikiId,
      result.pagesIndexed,
      result.sourcesIndexed,
      result.errors.length,
    );
    return c.json(result);
  });
};
