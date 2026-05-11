// cspell:words pdfs Buffett Buffett's Munger munger Liegl liegl GEICO keyperson
// Seed a pre-built wiki (schema + pages + claims + citations) directly so
// the UI demo flow runs end-to-end without depending on the LLM compile
// path. POSTs to the dev-only /__seed/wiki endpoint.

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { join } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const FIXTURES_DIR = resolve(REPO_ROOT, '.demo-fixtures');
const apiArg = process.argv.find((a) => a.startsWith('--api='));
const API_BASE = apiArg ? apiArg.replace('--api=', '') : 'http://localhost:8787';

const WIKI_ID = '22222222-2222-4222-8222-222222222222';
const DEMO_FOLDER_ID = '11111111-1111-4111-8111-111111111111';

const sha256Hex = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

const main = async () => {
  // We need real source ids + content hashes for the citations to point at,
  // so re-derive them from the local PDFs (matches what /__seed/fixtures
  // would have written). The seed-fixtures step must have run first; we
  // just look up the per-file hash here, not re-insert.
  const pdfs = readdirSync(FIXTURES_DIR)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort();

  // Fetch the actual sourceIds from D1 via the api so citations point at
  // them. The api's /__seed/fixtures rotates ids on each run, so we read
  // them via a simple SELECT-equivalent endpoint... we don't have one,
  // so instead we'll just make up stable ids that match what the seeded
  // sources happen to be at this moment. Easier: use a Source-listing
  // endpoint via the existing oRPC contract.
  const listRes = await fetch(`${API_BASE}/rpc/ingestion/listSources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: { folderId: DEMO_FOLDER_ID, limit: 20 } }),
  });
  let sources: Array<{ id: string; filename: string; contentHash: string }> = [];
  if (listRes.ok) {
    const j = (await listRes.json()) as {
      json: { items: Array<{ id: string; filename: string; contentHash: string }> };
    };
    sources = j.json.items;
  }
  if (sources.length === 0) {
    // Fallback: derive ids by filename hash (stable per-filename, but won't
    // line up with what's in D1 unless seed-fixtures was run with these
    // names — which it always is). Just hash the filename for an id.
    sources = pdfs.map((filename) => {
      const bytes = readFileSync(join(FIXTURES_DIR, filename));
      const h = sha256Hex(bytes);
      return {
        id: `00000000-0000-4${h.slice(0, 3)}-8${h.slice(3, 6)}-${h.slice(6, 18)}`,
        filename,
        contentHash: `sha256:${h}`,
      };
    });
  }

  // Per-source extracted text, fetched from `/__source/<id>/text`. The chat
  // synthesizer's `SourceHashVerifier` re-hashes the byte slice each
  // citation covers (not the whole source) and compares to
  // `citation.span.contentHash`. The previous seed used the whole-source
  // hash for every citation, which never matched the slice hash and made
  // every citation tripwire-fail. We now compute the real slice hash up
  // front so seeded citations validate end-to-end.
  const sourceTexts = new Map<string, string>();
  for (const s of sources) {
    const r = await fetch(`${API_BASE}/__source/${s.id}/text`);
    if (r.ok) {
      sourceTexts.set(s.id, await r.text());
    }
  }
  const sliceHash = (sourceId: string, start: number, end: number): string => {
    const text = sourceTexts.get(sourceId);
    if (text == null) {
      // Source text isn't loaded (seed-fixtures step skipped). Fall back to
      // the whole-source hash so we don't synth obviously-wrong data; the
      // verifier will still reject it, but at least we're not silently
      // pretending the slice was hashed.
      const src = sources.find((x) => x.id === sourceId);
      return src ? src.contentHash : `sha256:${'0'.repeat(64)}`;
    }
    const safeEnd = Math.min(end, text.length);
    const slice = text.slice(start, safeEnd);
    return `sha256:${sha256Hex(slice)}`;
  };

  const PAGE_TYPES = [
    {
      name: 'AnnualLetter',
      description:
        "Warren Buffett's yearly shareholder letter summarizing Berkshire's performance, philosophy, and key events for that year.",
    },
    {
      name: 'KeyPerson',
      description: 'An individual central to Berkshire — executives, partners, subsidiary leaders.',
    },
    {
      name: 'Subsidiary',
      description:
        'A company fully or partially owned by Berkshire Hathaway with its business profile and results.',
    },
    {
      name: 'Investment',
      description:
        'A marketable equity or capital allocation decision; partial ownership stakes in public companies.',
    },
  ];

  const src = (i: number) => {
    const found = sources[i] ?? sources[0];
    if (!found) throw new Error('seed-wiki: no sources available');
    return found;
  };

  type SeedPageInput = {
    id: string;
    subtype: 'Concept' | 'Summary' | 'Answer' | 'Index';
    pageType: string | null;
    slug: string;
    title: string;
    body: string;
    sourceId: string | null;
    question: string | null;
    indexEntriesJson: string | null;
    claims: Array<{
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
    }>;
  };

  const pages: SeedPageInput[] = [
    {
      id: randomUUID(),
      subtype: 'Concept' as const,
      pageType: 'KeyPerson',
      slug: 'charlie-munger',
      title: 'Charlie Munger',
      body: `## Charlie Munger\n\nCharlie Munger died on November 28, 2023, just 33 days before his 100th birthday — the architect of Berkshire Hathaway as we know it today.[[cite:cite-munger-death]]\n\n## Influence on Buffett\n\nIn 1965 Munger advised Buffett to abandon Ben Graham's "fair businesses at wonderful prices" and pivot to "wonderful businesses at fair prices."[[cite:cite-munger-pivot]] That single shift defined the next half-century of Berkshire's investment philosophy.\n\n## Communication style\n\nBuffett uses Bertie — his sister — as the platonic shareholder: smart, sensible, and deserving of direct, honest reports rather than corporate pablum.\n`,
      sourceId: null,
      question: null,
      indexEntriesJson: null,
      claims: [
        {
          id: randomUUID(),
          paragraphId: 'p-1',
          claimText:
            'Charlie Munger died on November 28, 2023, just 33 days before his 100th birthday.',
          citations: [
            {
              id: randomUUID(),
              sourceId: src(3).id,
              contentHash: sliceHash(src(3).id, 1240, 1410),
              byteRangeStart: 1240,
              byteRangeEnd: 1410,
              label: '2023 letter, p.1',
            },
          ],
        },
        {
          id: randomUUID(),
          paragraphId: 'p-2',
          claimText:
            "In 1965, Munger told Buffett to buy wonderful businesses at fair prices and abandon Ben Graham's approach.",
          citations: [
            {
              id: randomUUID(),
              sourceId: src(0).id,
              contentHash: sliceHash(src(0).id, 2100, 2280),
              byteRangeStart: 2100,
              byteRangeEnd: 2280,
              label: '2020 letter, p.3',
            },
          ],
        },
      ],
    },
    {
      id: randomUUID(),
      subtype: 'Concept' as const,
      pageType: 'Subsidiary',
      slug: 'forest-river',
      title: 'Forest River',
      body: `## Forest River\n\nForest River, the RV manufacturer Berkshire acquired in 2005, was profiled in the 2024 letter as a model Berkshire subsidiary — managed by founder Pete Liegl until his death.[[cite:cite-forest-river-pete]]\n\nThe company demonstrates Berkshire's "buy great companies and leave them alone" philosophy — Liegl ran Forest River with full operational autonomy for 19 years.\n`,
      sourceId: null,
      question: null,
      indexEntriesJson: null,
      claims: [
        {
          id: randomUUID(),
          paragraphId: 'p-1',
          claimText:
            "Pete Liegl founded Forest River and ran it autonomously after Berkshire's 2005 acquisition until his death.",
          citations: [
            {
              id: randomUUID(),
              sourceId: src(4).id,
              contentHash: sliceHash(src(4).id, 800, 1100),
              byteRangeStart: 800,
              byteRangeEnd: 1100,
              label: '2024 letter, p.2',
            },
          ],
        },
      ],
    },
    {
      id: randomUUID(),
      subtype: 'Summary' as const,
      pageType: null,
      slug: 'berkshire-2024-letter',
      title: '2024 Shareholder Letter Summary',
      body: `## 2024 Shareholder Letter\n\nThe 2024 letter combines candid admissions of past mistakes with a tribute to Pete Liegl and a summary of operating performance.[[cite:cite-2024-mistakes]]\n\nBuffett notes he used the words "mistake" or "error" 16 times across letters from 2019–2023, contrasting with most large companies that avoid such language entirely.\n`,
      sourceId: src(4).id,
      question: null,
      indexEntriesJson: null,
      claims: [
        {
          id: randomUUID(),
          paragraphId: 'p-1',
          claimText: "Buffett used 'mistake' or 'error' 16 times across his 2019–2023 letters.",
          citations: [
            {
              id: randomUUID(),
              sourceId: src(4).id,
              contentHash: sliceHash(src(4).id, 200, 400),
              byteRangeStart: 200,
              byteRangeEnd: 400,
              label: '2024 letter, p.1',
            },
          ],
        },
      ],
    },
  ];

  // Build the KeyPerson IndexPage deterministically from the seeded Concept
  // pages above. We reference real pageIds (so the markdown links route to
  // valid pages) and pull each entry's first-claim text as its teaser so the
  // index reads like a real wiki TOC. The intro paragraph echoes the
  // PageType description from the schema.
  const keyPersonPages = pages.filter((p) => p.subtype === 'Concept' && p.pageType === 'KeyPerson');
  const keyPersonDescription = PAGE_TYPES.find((pt) => pt.name === 'KeyPerson')?.description ?? '';
  const indexEntries = keyPersonPages.map((p) => ({
    pageId: p.id,
    title: p.title,
    summary: p.claims[0]?.claimText ?? `${p.title} page`,
  }));
  const indexIntro = `${keyPersonDescription}\n\nThis index lists every KeyPerson in the wiki.`;
  const indexBody = `${indexIntro}\n\n${indexEntries
    .map((e) => `- [${e.title}](/${e.pageId}) — ${e.summary}`)
    .join('\n')}`;
  pages.push({
    id: randomUUID(),
    subtype: 'Index' as const,
    pageType: 'KeyPerson',
    slug: 'index-keyperson',
    title: 'KeyPersons',
    body: indexBody,
    sourceId: null,
    question: null,
    indexEntriesJson: JSON.stringify(indexEntries),
    claims: [],
  });

  const payload = {
    wikiId: WIKI_ID,
    folderId: DEMO_FOLDER_ID,
    schema: {
      pageTypes: PAGE_TYPES,
      relations: [],
      reason:
        'The folder contains five Berkshire shareholder letters (2020-2024). The dominant entities are Buffett, Munger, key subsidiaries (Forest River, GEICO), and recurring investment themes.',
    },
    pages,
  };

  console.info(`POSTing pre-built wiki to ${API_BASE}/__seed/wiki ...`);
  const res = await fetch(`${API_BASE}/__seed/wiki`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`seed/wiki returned ${res.status}: ${text}`);
  }
  const json = await res.json();
  console.info('Done:', JSON.stringify(json));
  console.info(`\nNavigate to /wiki/${WIKI_ID} in the web UI.`);
};

main().catch((err) => {
  console.error('seed-wiki failed:', err);
  process.exit(1);
});
