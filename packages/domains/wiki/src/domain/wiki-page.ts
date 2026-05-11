import type { Citation, Claim, SourceId, WikiId, WikiPageId } from '@package/contracts/shared';
import type { Backlink } from './backlink.ts';

export type WikiPageSubtype = 'Concept' | 'Summary' | 'Answer' | 'Index';

// TD4 — phantom brand makes WikiPage.{concept,summary,answer,index} the
// only constructors. External code can read fields off a WikiPage but
// cannot synthesize a literal that bypasses freeze + invariant checks.
declare const wikiPageBrandSymbol: unique symbol;
type WikiPageBrand = { readonly [wikiPageBrandSymbol]: 'WikiPage' };

// Factory-arg helper: drop the brand AND the fields the factory itself
// computes/adds. Callers never see the brand symbol.
type FactoryArgs<P, OmittedKeys extends keyof P> = Omit<
  P,
  OmittedKeys | typeof wikiPageBrandSymbol
>;

interface BasePage extends WikiPageBrand {
  readonly id: WikiPageId;
  readonly wikiId: WikiId;
  readonly subtype: WikiPageSubtype;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly claims: ReadonlyArray<Claim>;
  readonly citations: ReadonlyArray<Citation>;
  readonly backlinks: ReadonlyArray<Backlink>;
  readonly updatedAt: string;
}

export interface ConceptPage extends BasePage {
  readonly subtype: 'Concept';
  readonly pageType: string;
}

export interface SummaryPage extends BasePage {
  readonly subtype: 'Summary';
  readonly sourceId: SourceId;
}

export interface AnswerPage extends BasePage {
  readonly subtype: 'Answer';
  readonly question: string;
}

export interface IndexEntry {
  readonly pageId: WikiPageId;
  readonly title: string;
  readonly summary?: string;
}

export interface IndexPage extends BasePage {
  readonly subtype: 'Index';
  readonly pageType: string;
  readonly entries: ReadonlyArray<IndexEntry>;
}

export type WikiPage = ConceptPage | SummaryPage | AnswerPage | IndexPage;

const collectCitations = (claims: ReadonlyArray<Claim>): ReadonlyArray<Citation> => {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of claims) {
    for (const cite of c.citations) {
      if (seen.has(cite.id)) continue;
      seen.add(cite.id);
      out.push(cite);
    }
  }
  return out;
};

export const WikiPage = {
  concept(
    props: FactoryArgs<ConceptPage, 'subtype' | 'citations' | 'backlinks'> & {
      backlinks?: Backlink[];
    },
  ): ConceptPage {
    if (!props.pageType) throw new Error('ConceptPage requires a pageType');
    return Object.freeze({
      id: props.id,
      wikiId: props.wikiId,
      pageType: props.pageType,
      slug: props.slug,
      title: props.title,
      body: props.body,
      updatedAt: props.updatedAt,
      subtype: 'Concept' as const,
      citations: collectCitations(props.claims),
      backlinks: Object.freeze([...(props.backlinks ?? [])]),
      claims: Object.freeze([...props.claims]),
    }) as ConceptPage;
  },
  summary(
    props: FactoryArgs<SummaryPage, 'subtype' | 'citations' | 'backlinks'> & {
      backlinks?: Backlink[];
    },
  ): SummaryPage {
    return Object.freeze({
      id: props.id,
      wikiId: props.wikiId,
      sourceId: props.sourceId,
      slug: props.slug,
      title: props.title,
      body: props.body,
      updatedAt: props.updatedAt,
      subtype: 'Summary' as const,
      citations: collectCitations(props.claims),
      backlinks: Object.freeze([...(props.backlinks ?? [])]),
      claims: Object.freeze([...props.claims]),
    }) as SummaryPage;
  },
  answer(
    props: FactoryArgs<AnswerPage, 'subtype' | 'citations' | 'backlinks'> & {
      backlinks?: Backlink[];
    },
  ): AnswerPage {
    return Object.freeze({
      id: props.id,
      wikiId: props.wikiId,
      question: props.question,
      slug: props.slug,
      title: props.title,
      body: props.body,
      updatedAt: props.updatedAt,
      subtype: 'Answer' as const,
      citations: collectCitations(props.claims),
      backlinks: Object.freeze([...(props.backlinks ?? [])]),
      claims: Object.freeze([...props.claims]),
    }) as AnswerPage;
  },
  index(
    props: FactoryArgs<IndexPage, 'subtype' | 'citations' | 'claims' | 'body' | 'backlinks'> & {
      backlinks?: Backlink[];
      // Optional plain-text intro paragraph(s) prepended above the entry list.
      // Used by the IndexBuilder to explain what the PageType covers so the
      // index reads like a wiki table-of-contents instead of a bare link list.
      intro?: string;
    },
  ): IndexPage {
    if (props.entries.length === 0) throw new Error('IndexPage requires at least one entry');
    const list = props.entries
      .map((e) => `- [${e.title}](/${e.pageId})${e.summary ? ` — ${e.summary}` : ''}`)
      .join('\n');
    const body =
      props.intro && props.intro.trim().length > 0 ? `${props.intro.trim()}\n\n${list}` : list;
    return Object.freeze({
      id: props.id,
      wikiId: props.wikiId,
      pageType: props.pageType,
      slug: props.slug,
      title: props.title,
      entries: Object.freeze([...props.entries]),
      updatedAt: props.updatedAt,
      subtype: 'Index' as const,
      claims: Object.freeze([] as Claim[]),
      citations: Object.freeze([] as Citation[]),
      backlinks: Object.freeze([...(props.backlinks ?? [])]),
      body,
    }) as IndexPage;
  },
};
