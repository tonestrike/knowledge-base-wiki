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
});
