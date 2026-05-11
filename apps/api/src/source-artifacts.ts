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

// R2 source proxy — returns the source's raw bytes (PDF), extracted text, or
// the per-page byte-offset outline. Used by the citation modal so the
// frontend can render the actual cited span (PDF page + overlay, or text
// excerpt). The lookup hits D1 to confirm the source exists, then streams
// the matching R2 object as a Response wrapping its arrayBuffer (R2's
// `body` ReadableStream isn't directly assignable to Response's BodyInit
// in the Workers types).
const serveSourceArtifact = async (
  env: SourceArtifactEnv,
  id: string,
  key: 'raw' | 'text' | 'outline.json',
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

/**
 * Mount the `/__source/:id/{raw,text,outline.json}` routes on the given Hono
 * app. The app is expected to be typed with bindings that include `DB` and
 * `STORAGE`; the cast to `SourceArtifactEnv` here is structural and safe.
 */
// biome-ignore lint/suspicious/noExplicitAny: app is generic over its Bindings
export const mountSourceArtifacts = (app: Hono<any>): void => {
  app.get('/__source/:id/raw', (c) =>
    serveSourceArtifact(c.env as SourceArtifactEnv, c.req.param('id'), 'raw'),
  );
  app.get('/__source/:id/text', (c) =>
    serveSourceArtifact(c.env as SourceArtifactEnv, c.req.param('id'), 'text'),
  );
  app.get('/__source/:id/outline.json', (c) =>
    serveSourceArtifact(c.env as SourceArtifactEnv, c.req.param('id'), 'outline.json'),
  );
};
