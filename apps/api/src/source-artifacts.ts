import type { Hono } from 'hono';

/**
 * Narrow env shape consumed by the source-artifact routes. The full Worker
 * `Env` in `index.ts` is a structural superset, so it satisfies this
 * automatically.
 */
interface SourceArtifactEnv {
  DB: D1Database;
  STORAGE: R2Bucket;
}

type ArtifactKey = 'raw' | 'text' | 'outline.json';

/**
 * R2 source proxy — returns the source's raw bytes (PDF), extracted text, or
 * the per-page byte-offset outline. Used by the citation modal so the
 * frontend can render the actual cited span (PDF page + overlay, or text
 * excerpt). The lookup hits D1 to confirm the source exists, then streams
 * the matching R2 object as a Response wrapping its arrayBuffer (R2's
 * `body` ReadableStream isn't directly assignable to Response's BodyInit
 * in the Workers types).
 */
const serveSourceArtifact = async (
  env: SourceArtifactEnv,
  id: string,
  key: ArtifactKey,
): Promise<Response> => {
  const row = await env.DB.prepare('SELECT mime FROM sources WHERE id = ?')
    .bind(id)
    .first<{ mime: string }>();
  if (!row) return new Response(JSON.stringify({ error: 'source not found' }), { status: 404 });
  const obj = await env.STORAGE.get(`sources/${id}/${key}`);
  if (!obj) {
    return new Response(JSON.stringify({ error: `source ${key} not stored` }), { status: 404 });
  }
  const buf = await obj.arrayBuffer();
  const headers = new Headers();
  if (key === 'raw') headers.set('Content-Type', row.mime);
  else if (key === 'text') headers.set('Content-Type', 'text/plain; charset=utf-8');
  else headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(buf, { headers });
};

export { serveSourceArtifact };

export interface MountSourceArtifactsOptions {
  /**
   * Caller-provided gate for `/raw` and `/outline.json`. Return `null` to
   * allow the request, or a `Response` (typically 401) to short-circuit.
   * `/text` is always public — wiki bodies embed extracted excerpts and the
   * citation popovers read that URL from the unauthenticated featured wiki.
   *
   * Omit to leave all three routes open (dev mode).
   */
  readonly requireSession?: (request: Request, env: SourceArtifactEnv) => Promise<Response | null>;
}

/**
 * Mount the `/__source/:id/{raw,text,outline.json}` routes. `raw` and
 * `outline.json` are gated by the injected `requireSession` callback when
 * provided; `text` is always public.
 */
export const mountSourceArtifacts = (
  // biome-ignore lint/suspicious/noExplicitAny: app is generic over its Bindings
  app: Hono<any>,
  options: MountSourceArtifactsOptions = {},
): void => {
  const gate = options.requireSession;
  const guarded = async (
    c: { env: unknown; req: { raw: Request; param: (k: string) => string } },
    key: 'raw' | 'outline.json',
  ): Promise<Response> => {
    const env = c.env as SourceArtifactEnv;
    if (gate) {
      const blocked = await gate(c.req.raw, env);
      if (blocked) return blocked;
    }
    return serveSourceArtifact(env, c.req.param('id'), key);
  };
  app.get('/__source/:id/raw', (c) => guarded(c, 'raw'));
  app.get('/__source/:id/text', (c) =>
    serveSourceArtifact(c.env as SourceArtifactEnv, c.req.param('id'), 'text'),
  );
  app.get('/__source/:id/outline.json', (c) => guarded(c, 'outline.json'));
};
