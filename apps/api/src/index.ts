import { completeDriveAuth } from '@domain/ingestion';
import {
  type SecretCipher,
  createD1FolderRepository,
  createD1OAuthRepository,
  createD1SourceRepository,
  createGoogleDocExtractor,
  createGoogleDriveConnector,
  createGoogleSheetExtractor,
  createGoogleSlideExtractor,
  createKVOAuthStateStore,
  createPdfExtractor,
  createR2SourceStorage,
} from '@domain/ingestion/infrastructure';
import type { IngestionContext } from '@domain/ingestion/interface';
import { OAuthTokenUnreadable } from '@domain/ingestion/ports';
import { subscribeWikiEvents } from '@domain/wiki/interface';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import type { UserId } from '@package/contracts/shared';
import { userId } from '@package/contracts/shared';
import { InMemoryEventBus, newId, systemClock } from '@package/shared-kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildChatContext } from './build-chat-context.ts';
import { buildVerificationContext } from './build-verification-deps.ts';
import { type WikiBindings, buildWikiContext, getSharedEventBus } from './build-wiki-deps.ts';
import { router } from './router.ts';

type Env = WikiBindings & {
  ENVIRONMENT: string;
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  // Drive OAuth credentials. Both prefixed (`GOOGLE_OAUTH_*`) and bare
  // (`GOOGLE_*`) names are accepted so the Worker reads whichever shape the
  // Infisical secret tree happens to use today — see `googleOAuthConfig`.
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT?: string;
  // Comma-separated list of web origins the OAuth callback is allowed to
  // 302 the user back to. Required in non-test envs so a malicious
  // `returnTo` from a tampered authStart can't steer the redirect at an
  // attacker-controlled host (open-redirect prevention). Falls back to the
  // request's own origin when unset, which is correct for production
  // single-origin deploys (Worker serves both `/rpc/*` and the SPA).
  WEB_APP_ORIGINS?: string;
  // SF1: required in every non-test environment. Boot-time check below throws
  // when missing so production never silently falls back to a zero key.
  OAUTH_TOKEN_KEY_BASE64: string;
};

/**
 * Resolve the Drive OAuth credentials from the Worker env, accepting either
 * the `GOOGLE_OAUTH_*` or bare `GOOGLE_*` secret names. The Infisical project
 * has carried both shapes at different points; the chat / drive flow only
 * cares that *some* matching trio is present.
 */
const googleOAuthConfig = (
  env: Env,
): { clientId: string; clientSecret: string; redirectUri: string } => ({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET ?? '',
  redirectUri:
    env.GOOGLE_OAUTH_REDIRECT ??
    env.GOOGLE_REDIRECT ??
    'http://localhost:8787/rpc/ingestion/authCallback',
});

// Single-user demo: every signed-in identity collapses to this UserId.
// Multi-user comes later.
const DEMO_USER_ID = userId('99999999-2222-4333-8444-555555555555');

// 32-byte zero key — only used as a fallback in the `test` environment so unit
// tests can construct a context without provisioning a real key. Production
// MUST set OAUTH_TOKEN_KEY_BASE64 via Infisical; the boot-time check below
// enforces this.
const ZERO_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const resolveTokenKey = (env: Env): string => {
  if (env.OAUTH_TOKEN_KEY_BASE64) return env.OAUTH_TOKEN_KEY_BASE64;
  if (env.ENVIRONMENT === 'test') return ZERO_KEY_BASE64;
  // SF1: fail loud at boot rather than silently encrypting/decrypting with a
  // zero key in production. The error message is what the operator sees in
  // logs / wrangler tail.
  throw new Error(
    'OAUTH_TOKEN_KEY_BASE64 is required in non-test environments. ' +
      'Set it via Infisical for the matching environment.',
  );
};

const createAesGcmCipher = (keyBase64: string): SecretCipher => {
  let cached: CryptoKey | null = null;
  const key = async (): Promise<CryptoKey> => {
    if (cached) return cached;
    cached = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    return cached;
  };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    async encrypt(plaintext: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(plaintext)),
      );
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv);
      out.set(ct, iv.length);
      return btoa(String.fromCharCode(...out));
    },
    async decrypt(ciphertext: string) {
      const all = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
      const iv = all.slice(0, 12);
      const ct = all.slice(12);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), ct);
      return dec.decode(pt);
    },
  };
};

// Refresh-token exchange against Google's token endpoint. Returns the new
// (accessToken, expiresAt) pair; Google rotates refresh_token only on revoke.
interface GoogleRefreshResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
}

const refreshGoogleAccessToken = async (
  env: Env,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string; refreshToken?: string }> => {
  const oauth = googleOAuthConfig(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`google refresh-token exchange failed: ${res.status}`);
  }
  const j = (await res.json()) as GoogleRefreshResponse;
  return {
    accessToken: j.access_token,
    expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
    refreshToken: j.refresh_token,
  };
};

// SF7: a tiny refresh threshold so we proactively swap the token before Drive
// returns 401. (Drive tokens last an hour; we refresh in the last minute.)
const REFRESH_SKEW_MS = 60_000;

const buildIngestionContext = (env: Env): IngestionContext => {
  const cipher = createAesGcmCipher(resolveTokenKey(env));
  const oauth = createD1OAuthRepository(env.DB, cipher);

  const loadOrThrow = async (userIdValue: UserId) => {
    try {
      return await oauth.loadTokens(userIdValue);
    } catch (err) {
      // SF2: keep the typed error visible to the caller. Surfacing
      // OAuthTokenUnreadable up to the oRPC layer lets the handler return a
      // typed 401 with a "Re-connect Drive" message, not an opaque 500.
      if (err instanceof OAuthTokenUnreadable) throw err;
      throw err;
    }
  };

  // Per-request access-token resolver: the connector calls this lazily, so
  // routers that don't need Drive (e.g. core/health) never touch D1.
  // SF6/SF7: honors `forceRefresh` after a 401, and proactively refreshes
  // when the stored token is within REFRESH_SKEW_MS of expiry.
  const getCurrentAccessToken = async (opts: { forceRefresh?: boolean } = {}): Promise<string> => {
    const stored = await loadOrThrow(DEMO_USER_ID);
    if (!stored) throw new Error('No Drive tokens — call ingestion.authStart first.');
    const expiresAt = Date.parse(stored.expiresAt);
    const isExpiring = Number.isFinite(expiresAt) && expiresAt - Date.now() < REFRESH_SKEW_MS;
    if (!opts.forceRefresh && !isExpiring) {
      return stored.accessToken;
    }
    const refreshed = await refreshGoogleAccessToken(env, stored.refreshToken);
    await oauth.saveTokens({
      userId: DEMO_USER_ID,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  };

  return {
    drive: (() => {
      const oauth = googleOAuthConfig(env);
      return createGoogleDriveConnector({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        redirectUri: oauth.redirectUri,
        resolveUserId: () => DEMO_USER_ID,
        getCurrentAccessToken,
      });
    })(),
    storage: createR2SourceStorage(env.STORAGE),
    sources: createD1SourceRepository(env.DB),
    folders: createD1FolderRepository(env.DB),
    oauth,
    oauthState: createKVOAuthStateStore(env.CACHE),
    eventBus: new InMemoryEventBus(),
    extractors: {
      pdf: createPdfExtractor(),
      doc: createGoogleDocExtractor(),
      sheet: createGoogleSheetExtractor(),
      slide: createGoogleSlideExtractor(),
    },
    newId,
    now: () => new Date(),
    clock: systemClock,
    currentUserId: DEMO_USER_ID,
  };
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/rpc/*',
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);

/**
 * Resolve the post-OAuth redirect target. The caller-provided `returnTo`
 * (echoed from the OAuth state) is honoured only if its origin matches an
 * entry in `WEB_APP_ORIGINS` (comma-separated env). Falls back to the
 * first allowlisted origin, then to `/` (works for single-origin prod
 * where the Worker serves both `/rpc/*` and the SPA).
 */
const resolveRedirect = (env: Env, returnTo: string | undefined, requestUrl: string): string => {
  const allow = (env.WEB_APP_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // The request's own origin is always allowlisted: in production the
  // Worker serves the SPA from this origin, so a `returnTo` that matches
  // it can never be a vector to anywhere else.
  try {
    allow.push(new URL(requestUrl).origin);
  } catch {
    /* ignore — env.WEB_APP_ORIGINS still applies */
  }
  if (returnTo) {
    try {
      const u = new URL(returnTo);
      if (allow.includes(u.origin)) return returnTo;
      console.warn('[ingestion.authCallback.GET] returnTo origin not in allowlist', {
        origin: u.origin,
      });
    } catch {
      /* malformed returnTo → fall through */
    }
  }
  // Default to "?drive=connected" on the first allowlisted origin so the
  // root route knows the user just completed sign-in.
  if (allow.length > 0) return `${allow[0]}/?drive=connected`;
  return '/?drive=connected';
};

// Google OAuth callback. Must be registered BEFORE the `/rpc/*` oRPC
// dispatcher below: the contract defines `ingestion.authCallback` as POST
// (typed RPC clients send the code/state in the body), but Google
// redirects the user-agent here with a GET carrying `?code=...&state=...`.
// Without this Hono GET, the dispatcher matches the path, sees the wrong
// method, and returns 405. We run the same use-case as the POST handler
// and 302 back to whichever web origin started the flow (validated
// against `WEB_APP_ORIGINS`) so the freshly stored Drive tokens are
// immediately usable from the SPA.
app.get('/rpc/ingestion/authCallback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.text('Missing code or state in Google callback.', 400);
  }
  try {
    const env = c.env as Env;
    const ingestion = buildIngestionContext(env);
    const result = await completeDriveAuth(ingestion, { code, state });
    return c.redirect(resolveRedirect(env, result.returnTo, c.req.url), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Drive OAuth callback failed.';
    console.error('[ingestion.authCallback.GET] failed', { err: message });
    return c.text(`Drive sign-in failed: ${message}`, 400);
  }
});

// Each sub-router is bound to its own `$context<X>` type. RPCHandler can't
// unify those into a single nominal context, so we erase the router's type
// at construction. The per-handler `.handler(...)` callbacks still see
// their own typed context slice — only the multi-context spread at handle
// time is unsafe, and we control what we pass there.
// biome-ignore lint/suspicious/noExplicitAny: cross-context router type erasure
const handler = new RPCHandler(router as any, {
  interceptors: [
    onError((error) => {
      console.error('[orpc]', error);
    }),
  ],
});

let subscriptionsBootstrapped = false;
const bootstrapSubscriptions = (env: Partial<WikiBindings>) => {
  if (subscriptionsBootstrapped) return;
  subscriptionsBootstrapped = true;
  const ctx = buildWikiContext(env, systemClock);
  subscribeWikiEvents(ctx.eventBus);
};

// Single-instance chat context, built lazily on first request and cached for
// subsequent ones. The dispatcher's in-memory tape lives on this instance —
// rebuilding it per request would lose in-flight chat conversations.
let chatContextSingleton: ReturnType<typeof buildChatContext> | null = null;
const ensureChatContext = (env: Env) => {
  if (chatContextSingleton) return chatContextSingleton;
  chatContextSingleton = buildChatContext({
    eventBus: getSharedEventBus(),
    bindings: {
      db: env.DB,
      storage: env.STORAGE,
      openRouterApiKey: (env as unknown as { OPEN_ROUTER_API_KEY?: string }).OPEN_ROUTER_API_KEY,
    },
  });
  return chatContextSingleton;
};

app.use('/rpc/*', async (c, next) => {
  // c.env is undefined when running under bun:test without executionContext;
  // we still want core/* routes to work in that case, so fall back to an
  // ENVIRONMENT=test stub. Ingestion routes will fail at use-time on missing
  // bindings, not here at construction time.
  const env = (c.env ?? { ENVIRONMENT: 'test' }) as Env;
  const ingestion = buildIngestionContext(env);
  bootstrapSubscriptions(env);
  const wiki = buildWikiContext(env, systemClock);
  const chatContext = ensureChatContext(env);
  const verification = buildVerificationContext(
    env as unknown as Parameters<typeof buildVerificationContext>[0],
    getSharedEventBus(),
    systemClock,
  );
  // Several ports collide across contexts (wiki/chat/verification all define
  // `dispatcher`; wiki/verification both define `runs`; wiki/ingestion both
  // define `sources`). Flattening with a single spread means the last writer
  // silently wins and hands handlers the wrong runtime. We resolve this by
  // inspecting the router slug (segment after /rpc/) and choosing which
  // context's bindings take precedence. Verification's dispatcher was
  // additionally renamed to `lintDispatcher` so it never participates in the
  // `dispatcher` collision.
  const url = new URL(c.req.raw.url);
  const slug = url.pathname.split('/')[2] ?? '';
  const flat = { ...wiki, ...ingestion, ...chatContext, ...verification, clock: systemClock };
  if (slug === 'wiki') {
    Object.assign(flat, {
      dispatcher: wiki.dispatcher,
      runs: wiki.runs,
      sources: wiki.sources,
    });
  } else if (slug === 'chat') {
    // `c.executionCtx.waitUntil` keeps the workerd isolate alive (and
    // scheduling I/O) past the response of `chat.ask`. The dispatcher's
    // fire-and-forget research/synthesis loop is started inside that handler;
    // without `waitUntil` workerd cancels new I/O the moment the response
    // flushes and the first `await` on D1 hangs forever. See SF-CHAT-11 in
    // `in-memory-dispatcher.ts`.
    Object.assign(flat, {
      dispatcher: chatContext.dispatcher,
      waitUntil: c.executionCtx?.waitUntil
        ? (p: Promise<unknown>) => c.executionCtx.waitUntil(p)
        : undefined,
    });
  } else if (slug === 'verification') {
    Object.assign(flat, { runs: verification.runs });
  } else if (slug === 'ingestion') {
    Object.assign(flat, { sources: ingestion.sources });
  }

  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    // biome-ignore lint/suspicious/noExplicitAny: cross-context union, see comment above
    context: flat as any,
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

app.get('/', (c) => c.text('tenex api'));

// R2 source proxy — returns the source's raw bytes (PDF), extracted text, or
// the per-page byte-offset outline. Used by the citation modal so the
// frontend can render the actual cited span (PDF page + overlay, or text
// excerpt). The lookup hits D1 to confirm the source exists, then streams
// the matching R2 object as a Response wrapping its arrayBuffer (R2's
// `body` ReadableStream isn't directly assignable to Response's BodyInit
// in the Workers types).
const serveSourceArtifact = async (
  env: Env,
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

app.get('/__source/:id/raw', (c) => serveSourceArtifact(c.env as Env, c.req.param('id'), 'raw'));
app.get('/__source/:id/text', (c) => serveSourceArtifact(c.env as Env, c.req.param('id'), 'text'));
app.get('/__source/:id/outline.json', (c) =>
  serveSourceArtifact(c.env as Env, c.req.param('id'), 'outline.json'),
);

// Dev-only seed endpoint. Bypasses Drive entirely by accepting pre-extracted
// PDF fixtures and writing them straight into D1 + R2 via the Worker
// bindings. Used for local demo / agent-browser testing — never exposed in
// non-dev environments.
app.post('/__seed/fixtures', async (c) => {
  const env = (c.env ?? {}) as Env;
  if (env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') {
    return c.json({ error: 'seed endpoint disabled in this environment' }, 403);
  }
  type SeedSource = {
    sourceId: string;
    filename: string;
    contentHash: string;
    mime: string;
    sizeBytes: number;
    modifiedAt: string;
    pageCount: number;
    rawBase64: string;
    text: string;
    outline: unknown;
  };
  type SeedRequest = {
    folderId: string;
    userId: string;
    driveFolderId: string;
    folderName: string;
    sources: SeedSource[];
  };
  const body = (await c.req.json()) as SeedRequest;
  const now = new Date().toISOString();

  await env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(body.folderId).run();
  await env.DB.prepare(
    'INSERT INTO folders (id, user_id, drive_folder_id, name, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(body.folderId, body.userId, body.driveFolderId, body.folderName, now)
    .run();

  for (const s of body.sources) {
    await env.DB.prepare(
      'INSERT INTO sources (id, folder_id, drive_file_id, filename, mime, size_bytes, modified_at, page_count, content_hash, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        s.sourceId,
        body.folderId,
        `seed-${s.sourceId}`,
        s.filename,
        s.mime,
        s.sizeBytes,
        s.modifiedAt,
        s.pageCount,
        s.contentHash,
        now,
      )
      .run();

    const rawBytes = Uint8Array.from(atob(s.rawBase64), (ch) => ch.charCodeAt(0));
    await env.STORAGE.put(`sources/${s.sourceId}/raw`, rawBytes, {
      httpMetadata: { contentType: s.mime },
    });
    await env.STORAGE.put(`sources/${s.sourceId}/text`, s.text, {
      httpMetadata: { contentType: 'text/plain' },
    });
    await env.STORAGE.put(`sources/${s.sourceId}/outline.json`, JSON.stringify(s.outline), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  return c.json({ ok: true, folderId: body.folderId, sourceCount: body.sources.length });
});

// Dev-only: seed a pre-built wiki (with a schema, pages, claims, citations,
// and bodies in R2) directly so the demo flow can be exercised without
// running the full LLM compile pipeline. Useful when the upstream compile
// is throttled / slow and you just want to verify wiki/page/lint UI.
app.post('/__seed/wiki', async (c) => {
  const env = (c.env ?? {}) as Env;
  if (env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') {
    return c.json({ error: 'seed endpoint disabled in this environment' }, 403);
  }
  type SeedClaim = {
    id: string;
    paragraphId: string;
    claimText: string;
    citations: Array<{
      id: string;
      sourceId: string;
      contentHash: string;
      byteRangeStart: number;
      byteRangeEnd: number;
      label: string;
    }>;
  };
  type SeedPage = {
    id: string;
    subtype: 'Concept' | 'Summary' | 'Answer' | 'Index';
    pageType: string | null;
    slug: string;
    title: string;
    body: string;
    sourceId: string | null;
    question: string | null;
    indexEntriesJson: string | null;
    claims: SeedClaim[];
  };
  type SeedRequest = {
    wikiId: string;
    folderId: string;
    schema: {
      pageTypes: Array<{ name: string; description: string }>;
      relations: unknown[];
      reason: string;
    };
    pages: SeedPage[];
  };
  const body = (await c.req.json()) as SeedRequest;
  const now = new Date().toISOString();

  await env.DB.prepare(
    'DELETE FROM citations WHERE claim_id IN (SELECT id FROM claims WHERE wiki_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id = ?))',
  )
    .bind(body.wikiId)
    .run();
  await env.DB.prepare(
    'DELETE FROM claims WHERE wiki_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id = ?)',
  )
    .bind(body.wikiId)
    .run();
  await env.DB.prepare(
    'DELETE FROM backlinks WHERE from_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id = ?)',
  )
    .bind(body.wikiId)
    .run();
  await env.DB.prepare('DELETE FROM wiki_pages WHERE wiki_id = ?').bind(body.wikiId).run();
  await env.DB.prepare('DELETE FROM wikis WHERE id = ?').bind(body.wikiId).run();
  // Also drop any other wiki record sitting on the same folder_id (e.g. a
  // half-finished compile-inferred wiki from a prior run) so the UNIQUE
  // constraint on wikis.folder_id doesn't block re-seeding.
  await env.DB.prepare(
    'DELETE FROM citations WHERE claim_id IN (SELECT id FROM claims WHERE wiki_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id IN (SELECT id FROM wikis WHERE folder_id = ?)))',
  )
    .bind(body.folderId)
    .run();
  await env.DB.prepare(
    'DELETE FROM claims WHERE wiki_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id IN (SELECT id FROM wikis WHERE folder_id = ?))',
  )
    .bind(body.folderId)
    .run();
  await env.DB.prepare(
    'DELETE FROM backlinks WHERE from_page_id IN (SELECT id FROM wiki_pages WHERE wiki_id IN (SELECT id FROM wikis WHERE folder_id = ?))',
  )
    .bind(body.folderId)
    .run();
  await env.DB.prepare(
    'DELETE FROM wiki_pages WHERE wiki_id IN (SELECT id FROM wikis WHERE folder_id = ?)',
  )
    .bind(body.folderId)
    .run();
  await env.DB.prepare('DELETE FROM wikis WHERE folder_id = ?').bind(body.folderId).run();

  await env.DB.prepare(
    'INSERT INTO wikis (id, folder_id, schema_json, created_at, updated_at, last_compiled_at, page_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(body.wikiId, body.folderId, JSON.stringify(body.schema), now, now, now, body.pages.length)
    .run();

  for (const p of body.pages) {
    // Align with `d1-wiki-page-repo.insertMany` which writes bodies at
    // `storage.put(p.id, p.body)` and reads them back via `storage.get(p.id)`.
    // The seed previously stored under `wiki_pages/<id>.md`, diverging from
    // the canonical writer and breaking the chat reader that hydrates wiki
    // pages by id. Keep the key identical to the page id so any consumer
    // (chat search, future re-rank) can hit one canonical R2 location.
    await env.STORAGE.put(p.id, p.body, { httpMetadata: { contentType: 'text/markdown' } });
    await env.DB.prepare(
      'INSERT INTO wiki_pages (id, wiki_id, subtype, page_type, slug, title, body_r2_key, source_id, question, index_entries_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        p.id,
        body.wikiId,
        p.subtype,
        p.pageType,
        p.slug,
        p.title,
        p.id,
        p.sourceId,
        p.question,
        p.indexEntriesJson,
        now,
      )
      .run();

    for (const c of p.claims) {
      await env.DB.prepare(
        'INSERT INTO claims (id, wiki_page_id, paragraph_id, claim_text, position) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(c.id, p.id, c.paragraphId, c.claimText, 0)
        .run();
      for (const cit of c.citations) {
        await env.DB.prepare(
          'INSERT INTO citations (id, claim_id, source_id, byte_range_start, byte_range_end, content_hash, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
          .bind(
            cit.id,
            c.id,
            cit.sourceId,
            cit.byteRangeStart,
            cit.byteRangeEnd,
            cit.contentHash,
            cit.label,
          )
          .run();
      }
    }
  }

  return c.json({ ok: true, wikiId: body.wikiId, pageCount: body.pages.length });
});

// Dev-only: seed a pre-built lint run + findings (one supported, one
// contradicted with a Correction) so the lint dashboard renders meaningful
// content without running the real Verifier (Opus 4.7 is expensive +
// requires the LintRun DO that's not yet wired locally).
app.post('/__seed/lint', async (c) => {
  const env = (c.env ?? {}) as Env;
  if (env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') {
    return c.json({ error: 'seed endpoint disabled' }, 403);
  }
  type SeedFinding = {
    id: string;
    wikiPageId: string;
    claimId: string;
    claimJson: string;
    verdict: 'supported' | 'unsupported' | 'contradicted';
    evidenceText: string;
    citedSpansJson: string;
    correctionJson: string | null;
  };
  type SeedRequest = {
    lintRunId: string;
    wikiId: string;
    findings: SeedFinding[];
  };
  const body = (await c.req.json()) as SeedRequest;
  const now = new Date().toISOString();
  const supportedCount = body.findings.filter((f) => f.verdict === 'supported').length;
  const unsupportedCount = body.findings.filter((f) => f.verdict === 'unsupported').length;
  const contradictedCount = body.findings.filter((f) => f.verdict === 'contradicted').length;

  await env.DB.prepare('DELETE FROM lint_findings WHERE lint_run_id = ?')
    .bind(body.lintRunId)
    .run();
  await env.DB.prepare('DELETE FROM lint_runs WHERE id = ?').bind(body.lintRunId).run();

  await env.DB.prepare(
    'INSERT INTO lint_runs (id, wiki_id, status, total_claims, audited, unsupported_count, contradicted_count, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      body.lintRunId,
      body.wikiId,
      'finished',
      body.findings.length,
      body.findings.length,
      unsupportedCount,
      contradictedCount,
      now,
      now,
    )
    .run();

  for (const f of body.findings) {
    await env.DB.prepare(
      'INSERT INTO lint_findings (id, lint_run_id, wiki_page_id, claim_id, claim_json, verdict, evidence_text, cited_spans_json, correction_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        f.id,
        body.lintRunId,
        f.wikiPageId,
        f.claimId,
        f.claimJson,
        f.verdict,
        f.evidenceText,
        f.citedSpansJson,
        f.correctionJson,
      )
      .run();
  }

  return c.json({
    ok: true,
    lintRunId: body.lintRunId,
    findingCount: body.findings.length,
    supported: supportedCount,
    unsupported: unsupportedCount,
    contradicted: contradictedCount,
  });
});

export { CompileRunDO } from './durable-objects.ts';

export default app;
