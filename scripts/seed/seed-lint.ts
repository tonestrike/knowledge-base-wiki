// cspell:words Munger munger Liegl
// Seed a pre-built lint run + findings so the lint dashboard renders.
// Pulls page + claim + citation ids from the wiki the seed-wiki step set up.

import { randomUUID } from 'node:crypto';

const apiArg = process.argv.find((a) => a.startsWith('--api='));
const API_BASE = apiArg ? apiArg.replace('--api=', '') : 'http://localhost:8787';
const WIKI_ID = '22222222-2222-4222-8222-222222222222';
const LINT_RUN_ID = '33333333-3333-4333-8333-333333333333';

const main = async () => {
  // Fetch claims from D1 by listing pages first (we need claim ids that point
  // at real wiki pages). Since the api doesn't expose listClaims as oRPC
  // (yet), we just hit listPages and pick a claim from the body... actually
  // easier: hardcode the structure since we just seeded it.
  // The seed-wiki script writes deterministic page slugs; we look those up
  // by re-fetching via the listPages endpoint and grabbing the embedded
  // claim ids from the response.
  // listPages doesn't include claims on pages — fetch each page individually
  const listRes = await fetch(`${API_BASE}/rpc/wiki/listPages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: { wikiId: WIKI_ID, limit: 50 } }),
  });
  type Page = {
    id: string;
    slug: string;
    claims: Array<{
      id: string;
      claimText: string;
      citations: Array<{
        span: { sourceId: string; byteRange: { start: number; end: number }; contentHash: string };
        label: string;
      }>;
    }>;
  };
  const j = (await listRes.json()) as { json: { items: Page[] } };
  const fetchPage = async (id: string): Promise<Page> => {
    const r = await fetch(`${API_BASE}/rpc/wiki/getPage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { id } }),
    });
    return ((await r.json()) as { json: Page }).json;
  };
  const pages = await Promise.all(j.json.items.map((p) => fetchPage(p.id)));
  const munger = pages.find((p) => p.slug === 'charlie-munger');
  const forestRiver = pages.find((p) => p.slug === 'forest-river');
  if (!munger || !forestRiver) throw new Error('missing seeded pages');

  const findings: Array<{
    id: string;
    wikiPageId: string;
    claimId: string;
    claimJson: string;
    verdict: 'supported' | 'unsupported' | 'contradicted';
    evidenceText: string;
    citedSpansJson: string;
    correctionJson: string | null;
  }> = [
    (() => {
      const c = munger.claims[0];
      if (!c) throw new Error('seed-lint: munger page has no claims');
      return {
        id: randomUUID(),
        wikiPageId: munger.id,
        claimId: c.id,
        claimJson: JSON.stringify(c),
        verdict: 'supported' as const,
        evidenceText:
          'Charlie Munger – The Architect of Berkshire Hathaway. Charlie Munger died on November 28, just 33 days before his 100th birthday.',
        citedSpansJson: JSON.stringify(c.citations),
        correctionJson: null,
      };
    })(),
    (() => {
      const c = forestRiver.claims[0];
      if (!c) throw new Error('seed-lint: forestRiver page has no claims');
      return {
        id: randomUUID(),
        wikiPageId: forestRiver.id,
        claimId: c.id,
        claimJson: JSON.stringify(c),
        verdict: 'contradicted' as const,
        evidenceText:
          'Pete Liegl, founder of Forest River, sold the company to Berkshire in 2005. He continued to run Forest River for the next 19 years until his death.',
        citedSpansJson: JSON.stringify(c.citations),
        correctionJson: JSON.stringify({
          replacementText:
            'Pete Liegl founded Forest River and ran it until his death 19 years after Berkshire acquired it in 2005.',
        }),
      };
    })(),
  ];

  const res = await fetch(`${API_BASE}/__seed/lint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lintRunId: LINT_RUN_ID, wikiId: WIKI_ID, findings }),
  });
  if (!res.ok) throw new Error(`seed/lint ${res.status}: ${await res.text()}`);
  console.info('Done:', JSON.stringify(await res.json()));
  console.info(`\nNavigate to /wiki/${WIKI_ID}/lint`);
};

main().catch((err) => {
  console.error('seed-lint failed:', err);
  process.exit(1);
});
