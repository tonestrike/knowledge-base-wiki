#!/usr/bin/env bun
/**
 * Citation-roundtrip eval — the hash-invariant tripwire for a deployed wiki.
 *
 * For every Citation on every WikiPage of a chosen wiki:
 *   1. Fetch the source text from `${API}/__source/<sourceId>/text` (cached).
 *   2. Slice `[byteRange.start, byteRange.end)` out of the source.
 *   3. sha256-hex the UTF-8 bytes of that slice.
 *   4. Compare against `citation.span.contentHash` (which encodes
 *      `sha256:<hex>` — see `packages/contracts/src/shared/ids.ts`).
 *
 * A passing run proves that — at the moment of the run — every citation
 * the deployed api will hand to the chat synth verifier *will* re-hash
 * cleanly. A failing citation is a real bug: either the source text
 * shifted under the wiki, the byte range encodes a different slice than
 * the LLM saw at compile time, or the hash was never recomputed after
 * the slice-hash migration.
 *
 * Why this exists (and isn't just a unit test): the in-process verifier
 * tests under `packages/domains/chat/src/application/verify-citation.test.ts`
 * cover the hashing logic in memory. They prove the *contract* holds; this
 * probe proves the *deployed* data still satisfies that contract end-to-end
 * — D1 rows + R2 text bodies + the proxy endpoint that hands them to the
 * verifier all agree.
 *
 * Usage:
 *   bun run evals:citation-roundtrip
 *   bun run evals:citation-roundtrip -- --wikiId=<uuid>
 *   bun run evals:citation-roundtrip -- --apiUrl=https://api.example.com
 *
 * Defaults to the featured wiki on the live deploy. Exits 0 only when
 * every citation passes; any failure is a real bug to escalate.
 */
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { WikiId, WikiPageId } from '@package/contracts/shared';

interface CliArgs {
  apiUrl: string;
  wikiId: string;
}

const DEFAULT_API = 'https://tenex-api.tonyvantur.workers.dev';
const DEFAULT_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

const parseArgs = (argv: string[]): CliArgs => {
  const out: CliArgs = { apiUrl: DEFAULT_API, wikiId: DEFAULT_WIKI_ID };
  for (const arg of argv) {
    if (arg.startsWith('--apiUrl=')) out.apiUrl = arg.slice('--apiUrl='.length);
    else if (arg.startsWith('--wikiId=')) out.wikiId = arg.slice('--wikiId='.length);
  }
  return out;
};

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

interface Failure {
  pageId: string;
  pageTitle: string;
  citationId: string;
  sourceId: string;
  start: number;
  end: number;
  expected: string;
  actual: string;
  reason: string;
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const link = new RPCLink({ url: `${args.apiUrl}/rpc` });
  const client = createORPCClient(link) as ContractRouterClient<Contract>;

  console.log(`[citation-roundtrip] api=${args.apiUrl}`);
  console.log(`[citation-roundtrip] wikiId=${args.wikiId}`);

  // listPages doesn't hydrate claims/citations on the page rows it returns —
  // that's a per-page join the api only does on `getPage`. Pull the page ids
  // first, then fan out `getPage` calls to get the citation arrays.
  const pageList = await client.wiki.listPages({
    wikiId: args.wikiId as WikiId,
    limit: 100,
  });
  console.log(`[citation-roundtrip] pages: ${pageList.items.length}`);

  const sourceTextCache = new Map<string, string | null>();
  const fetchSourceText = async (sourceId: string): Promise<string | null> => {
    const cached = sourceTextCache.get(sourceId);
    if (cached !== undefined) return cached;
    const resp = await fetch(`${args.apiUrl}/__source/${sourceId}/text`);
    if (!resp.ok) {
      sourceTextCache.set(sourceId, null);
      return null;
    }
    const text = await resp.text();
    sourceTextCache.set(sourceId, text);
    return text;
  };

  let citationsChecked = 0;
  let citationsPassed = 0;
  const failures: Failure[] = [];

  for (const summary of pageList.items) {
    const page = await client.wiki.getPage({ id: summary.id as WikiPageId });
    if (page.citations.length === 0) continue;
    for (const cit of page.citations) {
      citationsChecked += 1;
      const text = await fetchSourceText(cit.span.sourceId);
      if (text === null) {
        failures.push({
          pageId: page.id,
          pageTitle: page.title,
          citationId: cit.id,
          sourceId: cit.span.sourceId,
          start: cit.span.byteRange.start,
          end: cit.span.byteRange.end,
          expected: cit.span.contentHash,
          actual: '(no source)',
          reason: 'source text not found at /__source/<id>/text',
        });
        continue;
      }
      if (cit.span.byteRange.end > text.length) {
        failures.push({
          pageId: page.id,
          pageTitle: page.title,
          citationId: cit.id,
          sourceId: cit.span.sourceId,
          start: cit.span.byteRange.start,
          end: cit.span.byteRange.end,
          expected: cit.span.contentHash,
          actual: `(out of range; source length=${text.length})`,
          reason: 'byte range overruns source text',
        });
        continue;
      }
      const slice = text.slice(cit.span.byteRange.start, cit.span.byteRange.end);
      const actual = `sha256:${await sha256Hex(slice)}`;
      if (actual !== cit.span.contentHash) {
        failures.push({
          pageId: page.id,
          pageTitle: page.title,
          citationId: cit.id,
          sourceId: cit.span.sourceId,
          start: cit.span.byteRange.start,
          end: cit.span.byteRange.end,
          expected: cit.span.contentHash,
          actual,
          reason: 'hash mismatch',
        });
        continue;
      }
      citationsPassed += 1;
    }
  }

  const citationsFailed = failures.length;
  const pct = citationsChecked === 0 ? 0 : (citationsPassed / citationsChecked) * 100;
  console.log('');
  console.log(`[citation-roundtrip] checked: ${citationsChecked}`);
  console.log(`[citation-roundtrip] passed : ${citationsPassed}`);
  console.log(`[citation-roundtrip] failed : ${citationsFailed}`);
  console.log(`[citation-roundtrip] rate   : ${pct.toFixed(2)}%`);

  if (failures.length > 0) {
    console.log('');
    console.log('--- failures ---');
    for (const f of failures) {
      console.log(
        `page=${f.pageId} title="${f.pageTitle}" citation=${f.citationId} source=${f.sourceId} range=[${f.start},${f.end}) reason=${f.reason}`,
      );
      console.log(`  expected: ${f.expected}`);
      console.log(`  actual  : ${f.actual}`);
    }
    process.exit(1);
  }

  if (citationsChecked === 0) {
    console.log('');
    console.log('[citation-roundtrip] WARNING: no citations checked — wiki may be empty.');
    process.exit(2);
  }

  process.exit(0);
};

main().catch((err) => {
  console.error('[citation-roundtrip] fatal:', err);
  process.exit(2);
});
