import { describe, expect, it } from 'bun:test';
import { wikiId, wikiPageId } from '@package/contracts/shared';
import { type ConceptPage, WikiPage } from '../domain/wiki-page.ts';
import { buildIndexes } from './build-indexes.ts';
import { resolveBacklinks } from './resolve-backlinks.ts';

const WID = wikiId('44444444-2222-4333-8444-555555555555');
const concept = (id: string, pageType: string, title: string, body?: string): ConceptPage =>
  WikiPage.concept({
    id: wikiPageId(id),
    wikiId: WID,
    pageType,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    title,
    body: body ?? 'Refers to [Q3 board](/dddddddd-1111-4222-8333-444444444450).',
    claims: [],
    updatedAt: '2026-05-09T12:00:00.000Z',
  });

describe('resolveBacklinks', () => {
  it('infers backlinks from markdown link targets', () => {
    const a = concept(
      'dddddddd-1111-4222-8333-444444444401',
      'Decision',
      'Approve EMEA',
      'see [Q3 board](/dddddddd-1111-4222-8333-444444444450)',
    );
    const b = concept(
      'dddddddd-1111-4222-8333-444444444450',
      'Person',
      'Q3 board',
      'see [Approve](/dddddddd-1111-4222-8333-444444444401)',
    );
    const out = resolveBacklinks(
      [a, b],
      [{ name: 'DecidedAt', from: 'Decision', to: 'Person', cardinality: 'many-to-one' }],
    );
    expect(out.backlinks.length).toBeGreaterThan(0);
    const decidedAt = out.backlinks.find((bl) => bl.relationName === 'DecidedAt');
    expect(decidedAt).toBeTruthy();
  });

  it('drops links to unknown ids and self-links', () => {
    const a = concept(
      'dddddddd-1111-4222-8333-444444444401',
      'Decision',
      'A',
      'self [a](/dddddddd-1111-4222-8333-444444444401) and ghost [g](/00000000-0000-4000-8000-000000000000)',
    );
    const out = resolveBacklinks([a], []);
    expect(out.backlinks).toEqual([]);
  });
});

describe('buildIndexes', () => {
  it('emits one IndexPage per PageType when there are concept pages of that type', () => {
    const pages = [
      concept('dddddddd-1111-4222-8333-444444444401', 'Decision', 'Approve EMEA'),
      concept('dddddddd-1111-4222-8333-444444444402', 'Decision', 'Hire CFO'),
      concept('dddddddd-1111-4222-8333-444444444403', 'Metric', 'Q3 NRR'),
    ];
    let cursor = 0;
    const out = buildIndexes({
      wikiId: WID,
      pages,
      pageTypes: ['Decision', 'Metric', 'Risk'],
      newId: () => `dddddddd-1111-4222-8333-555555555${String(cursor++).padStart(3, '0')}`,
      now: () => new Date('2026-05-09T12:00:00.000Z'),
    });
    expect(out.indexPages).toHaveLength(2); // Risk has no entries → skipped
    const decisionIndex = out.indexPages.find((ip) => ip.pageType === 'Decision');
    expect(decisionIndex?.entries).toHaveLength(2);
  });

  it('produces a body with the PageType description and per-entry teasers from the first claim', () => {
    const withClaim = (
      id: string,
      pageType: string,
      title: string,
      claimText: string,
    ): ConceptPage =>
      WikiPage.concept({
        id: wikiPageId(id),
        wikiId: WID,
        pageType,
        slug: title.toLowerCase().replaceAll(' ', '-'),
        title,
        body: 'irrelevant',
        claims: [
          {
            id: '11111111-1111-4111-8111-111111111111' as unknown as ConceptPage['claims'][number]['id'],
            wikiPageId: wikiPageId(id),
            paragraphId: 'p-1',
            claimText,
            citations: [],
          },
        ],
        updatedAt: '2026-05-09T12:00:00.000Z',
      });

    const pages = [
      withClaim(
        'dddddddd-1111-4222-8333-444444444410',
        'Decision',
        'Approve EMEA',
        'EMEA expansion approved at the Q3 board meeting after the CFO pushed back twice.',
      ),
      withClaim(
        'dddddddd-1111-4222-8333-444444444411',
        'Decision',
        'Hire CFO',
        'Hired Jane Doe as CFO effective January 2025.',
      ),
    ];
    let cursor = 0;
    const out = buildIndexes({
      wikiId: WID,
      pages,
      pageTypes: ['Decision'],
      pageTypeDescriptions: {
        Decision: 'A choice made by the leadership team with cited rationale.',
      },
      newId: () => `dddddddd-1111-4222-8333-666666666${String(cursor++).padStart(3, '0')}`,
      now: () => new Date('2026-05-09T12:00:00.000Z'),
    });
    expect(out.indexPages).toHaveLength(1);
    const ip = out.indexPages[0];
    expect(ip?.body).toContain('A choice made by the leadership team');
    expect(ip?.body).toContain('This index lists every Decision');
    expect(ip?.body).toContain('Approve EMEA');
    expect(ip?.body).toContain('EMEA expansion approved');
    expect(ip?.body).toContain('Hire CFO');
    expect(ip?.body).toContain('Hired Jane Doe');
    expect(ip?.entries[0]?.summary).toContain('EMEA expansion');
  });

  it('caps the assembled body at ~3000 chars', () => {
    const long = 'x'.repeat(5000);
    const pages = [
      WikiPage.concept({
        id: wikiPageId('dddddddd-1111-4222-8333-444444444420'),
        wikiId: WID,
        pageType: 'Decision',
        slug: 'd',
        title: 'D',
        body: 'b',
        claims: [],
        updatedAt: '2026-05-09T12:00:00.000Z',
      }),
    ];
    const out = buildIndexes({
      wikiId: WID,
      pages,
      pageTypes: ['Decision'],
      pageTypeDescriptions: { Decision: long },
      newId: () => 'dddddddd-1111-4222-8333-666666666999',
      now: () => new Date('2026-05-09T12:00:00.000Z'),
    });
    expect(out.indexPages[0]?.body.length).toBeLessThanOrEqual(3001);
  });
});
