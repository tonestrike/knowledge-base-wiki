import type { Citation, Claim, SourceId, WikiId, WikiPageId } from '@package/contracts/shared';
import type { Backlink } from './backlink.ts';

export type WikiPageSubtype = 'Concept' | 'Summary' | 'Answer' | 'Index';

interface BasePage {
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
  readonly pageType?: string;
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
    props: Omit<ConceptPage, 'subtype' | 'citations' | 'backlinks'> & { backlinks?: Backlink[] },
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
    });
  },
  summary(
    props: Omit<SummaryPage, 'subtype' | 'citations' | 'backlinks'> & { backlinks?: Backlink[] },
  ): SummaryPage {
    return Object.freeze({
      id: props.id,
      wikiId: props.wikiId,
      sourceId: props.sourceId,
      slug: props.slug,
      title: props.title,
      body: props.body,
      updatedAt: props.updatedAt,
      pageType: props.pageType,
      subtype: 'Summary' as const,
      citations: collectCitations(props.claims),
      backlinks: Object.freeze([...(props.backlinks ?? [])]),
      claims: Object.freeze([...props.claims]),
    });
  },
  answer(
    props: Omit<AnswerPage, 'subtype' | 'citations' | 'backlinks'> & { backlinks?: Backlink[] },
  ): AnswerPage {
    return Object.freeze({
      id: props.id,
      wikiId: props.wikiId,
      question: props.question,
      slug: props.slug,
      title: props.title,
      body: props.body,
      updatedAt: props.updatedAt,
      pageType: props.pageType,
      subtype: 'Answer' as const,
      citations: collectCitations(props.claims),
      backlinks: Object.freeze([...(props.backlinks ?? [])]),
      claims: Object.freeze([...props.claims]),
    });
  },
  index(
    props: Omit<IndexPage, 'subtype' | 'citations' | 'claims' | 'body' | 'backlinks'> & {
      backlinks?: Backlink[];
    },
  ): IndexPage {
    if (props.entries.length === 0) throw new Error('IndexPage requires at least one entry');
    const body = props.entries
      .map((e) => `- [${e.title}](/${e.pageId})${e.summary ? ` — ${e.summary}` : ''}`)
      .join('\n');
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
    });
  },
};
