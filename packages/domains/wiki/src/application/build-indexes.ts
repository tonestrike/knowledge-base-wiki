import { type WikiId, wikiPageId } from '@package/contracts/shared';
import { type ConceptPage, type IndexPage, WikiPage } from '../domain/wiki-page.ts';

const pluralize = (s: string): string => (s.endsWith('s') ? s : `${s}s`);

// IndexBuilder — pure aggregation. One IndexPage per non-empty PageType.
export function buildIndexes(input: {
  wikiId: WikiId;
  pages: ReadonlyArray<{
    id: ConceptPage['id'];
    pageType?: string;
    title: string;
    subtype: string;
  }>;
  pageTypes: ReadonlyArray<string>;
  newId: () => string;
  now: () => Date;
}): { indexPages: IndexPage[] } {
  const concepts = input.pages.filter(
    (p): p is { id: ConceptPage['id']; pageType: string; title: string; subtype: 'Concept' } =>
      p.subtype === 'Concept' && typeof p.pageType === 'string' && p.pageType.length > 0,
  );
  const out: IndexPage[] = [];

  for (const pt of input.pageTypes) {
    const matching = concepts.filter((c) => c.pageType === pt);
    if (matching.length === 0) continue;
    out.push(
      WikiPage.index({
        id: wikiPageId(input.newId()),
        wikiId: input.wikiId,
        pageType: pt,
        slug: `index-${pt.toLowerCase()}`,
        title: pluralize(pt),
        entries: matching.map((c) => ({ pageId: c.id, title: c.title })),
        updatedAt: input.now().toISOString(),
      }),
    );
  }
  return { indexPages: out };
}
