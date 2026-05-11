// Cloudflare binding shapes used by the chat adapters. Canonical structural
// typings live in `@package/shared-kernel`; this file is a thin re-export so
// existing relative imports inside the chat package keep working.

export type {
  D1Database,
  D1PreparedStatement,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  R2Body,
  R2Bucket,
} from '@package/shared-kernel';
