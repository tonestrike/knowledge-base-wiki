// Cloudflare binding shapes used by the ingestion adapters. Defined once in
// `@package/shared-kernel`; re-exported here so existing relative imports in
// this package (and external consumers via the infrastructure barrel) keep
// working. shared-kernel stays framework-free; apps/api injects the real
// workers-types-backed bindings at the composition seam.

export type {
  D1Database,
  D1DatabaseLike,
  D1PreparedStatement,
  KVNamespace,
  KVNamespaceLike,
  R2Body,
  R2Bucket,
  R2BucketLike,
} from '@package/shared-kernel';
