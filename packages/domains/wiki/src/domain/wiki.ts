import type { FolderId, WikiId, WikiSchema } from '@package/contracts/shared';
import { type ArityViolation, type Backlink, partitionBacklinksByArity } from './backlink.ts';
import type { ConceptPage, IndexPage } from './wiki-page.ts';

// TD4 — `Wiki` carries a phantom brand so external code cannot synthesize
// a Wiki literal that bypasses Wiki.create's invariants and freeze. The
// brand is `unique symbol`-based and lives in module scope — there is no
// way to construct a value of type `WikiBrand` without going through
// Wiki.create.
declare const wikiBrandSymbol: unique symbol;
type WikiBrand = { readonly [wikiBrandSymbol]: 'Wiki' };

export interface Wiki extends WikiBrand {
  readonly id: WikiId;
  readonly folderId: FolderId;
  readonly schema: WikiSchema;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastCompiledAt?: string;
  readonly pageCount: number;
  /**
   * Optional perspective the wiki was compiled under. Threaded into the
   * SchemaInferrer / ResearchSource / DraftPage / NarrateIndexes prompts
   * at compile time so the wiki's PageTypes, page bodies, and narration
   * reflect the lens (e.g. "find business opportunities").
   */
  readonly perspective?: string;
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
    perspective?: string;
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
      ...(props.perspective !== undefined ? { perspective: props.perspective } : {}),
    }) as Wiki;
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
  // TD1 — partition the candidate backlinks against the wiki's relation
  // cardinality. Returns the kept set + a typed list of violations the
  // caller emits as BacklinkArityViolated events. Violations are NEVER
  // silently dropped without surfacing.
  addBacklinks(
    wiki: Wiki,
    candidates: ReadonlyArray<Backlink>,
  ): { kept: Backlink[]; violations: ArityViolation[] } {
    return partitionBacklinksByArity(candidates, wiki.schema.relations);
  },
  recordCompile(wiki: Wiki, at: string, pageCount: number): Wiki {
    return Object.freeze({ ...wiki, updatedAt: at, lastCompiledAt: at, pageCount }) as Wiki;
  },
};
