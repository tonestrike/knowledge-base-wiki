import type { Hono } from 'hono';

interface DevEnv {
  ENVIRONMENT?: string;
  DB: D1Database;
  STORAGE: R2Bucket;
}

/**
 * Single env gate for every `/__dev/*` and `/__seed/*` route. Prevents the
 * dev/seed surface from accidentally being reachable in production, where
 * the routes would otherwise let an unauthenticated caller mutate D1/R2.
 */
const isDevEnvironment = (env: DevEnv): boolean =>
  env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test';

const devOnly = (env: DevEnv): Response | null =>
  isDevEnvironment(env)
    ? null
    : new Response(JSON.stringify({ error: 'dev endpoint disabled in this environment' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });

/**
 * Mount the dev-only `/__dev/*` and `/__seed/*` routes. Every handler is
 * gated by `devOnly` so non-dev/non-test environments respond 403 before
 * any handler logic runs.
 */
// biome-ignore lint/suspicious/noExplicitAny: app is generic over its Bindings
export const mountDevRoutes = (app: Hono<any>): void => {
  /**
   * Dev-only one-shot: re-stamp every citation row's `content_hash` with the
   * sha256 of the actual `[byteRangeStart, byteRangeEnd]` slice of the
   * referenced source text. Heals wikis compiled before commit b727140
   * ("hash citation slice (not whole source)") — those citations carry the
   * whole-source hash, so chat's SourceHashVerifier tripwires every claim.
   *
   * Idempotent: a citation already carrying the correct slice hash is
   * untouched. Returns a JSON summary of how many were updated, how many
   * were already correct, and how many had unresolvable sources (so an
   * operator can decide whether a recompile is still needed).
   */
  app.post('/__dev/rehash-citations', async (c) => {
    const env = (c.env ?? {}) as DevEnv;
    const blocked = devOnly(env);
    if (blocked) return blocked;
    if (!env.DB || !env.STORAGE) return c.json({ error: 'D1/R2 bindings missing' }, 500);

    const sha256Hex = async (s: string): Promise<string> => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };

    const rows = await env.DB.prepare(
      'SELECT id, source_id, byte_range_start, byte_range_end, content_hash FROM citations',
    ).all<{
      id: string;
      source_id: string;
      byte_range_start: number;
      byte_range_end: number;
      content_hash: string;
    }>();

    const sourceTextCache = new Map<string, string | null>();
    let updated = 0;
    let alreadyCorrect = 0;
    let missingSource = 0;
    let outOfRange = 0;

    for (const r of rows.results) {
      let text = sourceTextCache.get(r.source_id);
      if (text === undefined) {
        const obj = await env.STORAGE.get(`sources/${r.source_id}/text`);
        text = obj ? await obj.text() : null;
        sourceTextCache.set(r.source_id, text);
      }
      if (!text) {
        missingSource += 1;
        continue;
      }
      if (r.byte_range_end > text.length) {
        outOfRange += 1;
        continue;
      }
      const slice = text.slice(r.byte_range_start, r.byte_range_end);
      const expected = `sha256:${await sha256Hex(slice)}`;
      if (r.content_hash === expected) {
        alreadyCorrect += 1;
        continue;
      }
      await env.DB.prepare('UPDATE citations SET content_hash = ? WHERE id = ?')
        .bind(expected, r.id)
        .run();
      updated += 1;
    }

    return c.json({
      scanned: rows.results.length,
      updated,
      alreadyCorrect,
      missingSource,
      outOfRange,
      note:
        missingSource > 0
          ? 'Some citations reference sources without extracted text — recompile those folders.'
          : undefined,
    });
  });

  // Dev-only seed endpoint. Bypasses Drive entirely by accepting pre-extracted
  // PDF fixtures and writing them straight into D1 + R2 via the Worker
  // bindings. Used for local demo / agent-browser testing — never exposed in
  // non-dev environments.
  app.post('/__seed/fixtures', async (c) => {
    const env = (c.env ?? {}) as DevEnv;
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
    const env = (c.env ?? {}) as DevEnv;
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
      .bind(
        body.wikiId,
        body.folderId,
        JSON.stringify(body.schema),
        now,
        now,
        now,
        body.pages.length,
      )
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

      for (const cl of p.claims) {
        await env.DB.prepare(
          'INSERT INTO claims (id, wiki_page_id, paragraph_id, claim_text, position) VALUES (?, ?, ?, ?, ?)',
        )
          .bind(cl.id, p.id, cl.paragraphId, cl.claimText, 0)
          .run();
        for (const cit of cl.citations) {
          await env.DB.prepare(
            'INSERT INTO citations (id, claim_id, source_id, byte_range_start, byte_range_end, content_hash, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
            .bind(
              cit.id,
              cl.id,
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
    const env = (c.env ?? {}) as DevEnv;
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
};
