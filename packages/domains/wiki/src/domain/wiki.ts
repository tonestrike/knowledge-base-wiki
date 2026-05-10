import type { FolderId, WikiId, WikiSchema } from '@package/contracts/shared';

export interface Wiki {
  readonly id: WikiId;
  readonly folderId: FolderId;
  readonly schema: WikiSchema;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastCompiledAt?: string;
  readonly pageCount: number;
}

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
  recordCompile(wiki: Wiki, at: string, pageCount: number): Wiki {
    return Object.freeze({ ...wiki, updatedAt: at, lastCompiledAt: at, pageCount });
  },
};
