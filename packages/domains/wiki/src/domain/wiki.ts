import type { FolderId, WikiId, WikiSchema } from '@package/contracts/shared';
import type { ConceptPage, IndexPage } from './wiki-page.ts';

export interface Wiki {
  readonly id: WikiId;
  readonly folderId: FolderId;
  readonly schema: WikiSchema;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastCompiledAt?: string;
  readonly pageCount: number;
}

export class UnknownPageTypeError extends Error {
  constructor(
    readonly pageType: string,
    readonly knownPageTypes: ReadonlyArray<string>,
  ) {
    super(`pageType "${pageType}" is not in the wiki schema (known: ${knownPageTypes.join(', ')})`);
    this.name = 'UnknownPageTypeError';
  }
}

const isPageTypeKnown = (wiki: Wiki, pageType: string): boolean =>
  wiki.schema.pageTypes.some((p) => p.name === pageType);

export const Wiki = {
  create(props: {
    id: WikiId;
    folderId: FolderId;
    schema: WikiSchema;
    createdAt: string;
    updatedAt?: string;
    lastCompiledAt?: string;
    pageCount?: number;
  }): Wiki {
    if (props.schema.pageTypes.length === 0) {
      throw new Error('Wiki requires at least one PageType in its schema');
    }
    return Object.freeze({
      id: props.id,
      folderId: props.folderId,
      schema: props.schema,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt ?? props.createdAt,
      lastCompiledAt: props.lastCompiledAt,
      pageCount: props.pageCount ?? 0,
    });
  },
  // Structurally validates that a Concept/Index page's pageType is one of
  // the wiki's schema.pageTypes — the orchestrator must call this before
  // persisting drafted pages, otherwise downstream queries (filter by
  // pageType) silently miss pages the schema never declared.
  assertPageTypeKnown(wiki: Wiki, page: ConceptPage | IndexPage): void {
    if (!isPageTypeKnown(wiki, page.pageType)) {
      throw new UnknownPageTypeError(
        page.pageType,
        wiki.schema.pageTypes.map((p) => p.name),
      );
    }
  },
  recordCompile(wiki: Wiki, at: string, pageCount: number): Wiki {
    return Object.freeze({ ...wiki, updatedAt: at, lastCompiledAt: at, pageCount });
  },
};
