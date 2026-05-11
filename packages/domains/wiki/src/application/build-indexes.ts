import { type WikiId, wikiPageId } from '@package/contracts/shared';
import { type ConceptPage, type IndexPage, WikiPage } from '../domain/wiki-page.ts';

const pluralize = (s: string): string => (s.endsWith('s') ? s : `${s}s`);

// Cap each per-entry teaser so a long first claim doesn't dominate the
// index page; the user is meant to click through to read the full entry.
const TEASER_MAX = 160;
// Hard ceiling on the assembled index body so an oversized PageType
// description + many entries can't bloat R2 storage indefinitely.
const BODY_MAX = 3000;

const truncate = (s: string, max: number): string => {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  // Cut at the last word boundary before `max - 1` so we don't slice mid-word.
  const cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

// IndexBuilder — pure aggregation. One IndexPage per non-empty PageType.
// Produces a wiki-style table-of-contents body: a short intro describing
// what this PageType covers (pulled deterministically from the schema),
// followed by one bulleted entry per ConceptPage with a teaser drawn from
// that page's first Claim's claimText when available.
export function buildIndexes(input: {
  wikiId: WikiId;
  pages: ReadonlyArray<{
    id: ConceptPage['id'];
    pageType?: string;
    title: string;
    subtype: string;
    // Optional: first-claim text used as the per-entry teaser. Callers that
    // hand in real ConceptPages get this for free; tests can omit it.
    claims?: ReadonlyArray<{ claimText: string }>;
  }>;
  pageTypes: ReadonlyArray<string>;
  // Optional descriptions for each PageType, indexed by name. Sourced from
  // WikiSchema.pageTypes[].description; surfaces in the index intro so the
  // reader knows what kind of entity this index covers.
  pageTypeDescriptions?: Readonly<Record<string, string>>;
  newId: () => string;
  now: () => Date;
}): { indexPages: IndexPage[] } {
  const concepts = input.pages.filter(
    (
      p,
    ): p is {
      id: ConceptPage['id'];
      pageType: string;
      title: string;
      subtype: 'Concept';
      claims?: ReadonlyArray<{ claimText: string }>;
    } => p.subtype === 'Concept' && typeof p.pageType === 'string' && p.pageType.length > 0,
  );
  const out: IndexPage[] = [];

  for (const pt of input.pageTypes) {
    const matching = concepts.filter((c) => c.pageType === pt);
    if (matching.length === 0) continue;
    const description = input.pageTypeDescriptions?.[pt]?.trim();
    const intro = description
      ? `${description}\n\nThis index lists every ${pt} in the wiki.`
      : `This index lists every ${pt} in the wiki.`;

    const entries = matching.map((c) => {
      const firstClaim = c.claims?.[0]?.claimText?.trim();
      const teaser = firstClaim ? truncate(firstClaim, TEASER_MAX) : `${pt} page`;
      return { pageId: c.id, title: c.title, summary: teaser };
    });

    let page = WikiPage.index({
      id: wikiPageId(input.newId()),
      wikiId: input.wikiId,
      pageType: pt,
      slug: `index-${pt.toLowerCase()}`,
      title: pluralize(pt),
      entries,
      intro,
      updatedAt: input.now().toISOString(),
    });

    // Truncate the assembled body if it exceeded the cap. We rebuild via the
    // factory rather than mutating the frozen page so the entries shown to
    // readers always match the bullet list rendered in the body.
    if (page.body.length > BODY_MAX) {
      const overflow = page.body.length - BODY_MAX;
      const trimmedIntro = truncate(intro, Math.max(80, intro.length - overflow));
      page = WikiPage.index({
        id: page.id,
        wikiId: input.wikiId,
        pageType: pt,
        slug: page.slug,
        title: page.title,
        entries,
        intro: trimmedIntro,
        updatedAt: page.updatedAt,
      });
    }
    out.push(page);
  }
  return { indexPages: out };
}
