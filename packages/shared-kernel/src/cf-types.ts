// Canonical structural typings for the Cloudflare runtime bindings consumed
// across domain packages. These mirror — but do not import — the relevant
// subset of `@cloudflare/workers-types`. Keeping them framework-free here lets
// every `packages/domains/*` adapter declare a binding parameter without
// pulling Cloudflare-specific dependencies into the domain graph; apps/api
// (which DOES depend on the real workers-types) supplies a structurally
// compatible value at the composition seam.
//
// shared-kernel is intentionally tiny. These types live here only because
// three or more bounded contexts (ingestion, wiki, chat, verification) each
// need the same shapes; before this consolidation every domain redeclared
// them locally with subtle drift.

// --- D1 -------------------------------------------------------------------

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; success?: boolean }>;
  run(): Promise<{ success?: boolean }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<Array<{ success?: boolean }>>;
}

// Historical alias used by the ingestion package. New code should prefer
// `D1Database`; this stays only so existing adapters keep compiling.
export type D1DatabaseLike = D1Database;

// --- R2 -------------------------------------------------------------------

export interface R2Body {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Bucket {
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2Body | null>;
  delete(key: string): Promise<void>;
}

// Historical alias used by the ingestion package. See note on D1DatabaseLike.
export type R2BucketLike = R2Bucket;

// --- Vectorize ------------------------------------------------------------

/**
 * Structural shape of a Cloudflare Vectorize index binding. Mirrors the
 * subset of `@cloudflare/workers-types`' `VectorizeIndex` the chat
 * package's `VectorWikiReader` consumes. Lives in shared-kernel so the
 * declaration is framework-free; apps/api supplies a structurally
 * compatible value at the composition seam.
 */
export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorizeQueryResult {
  matches: VectorizeMatch[];
  count?: number;
}

export interface VectorizeVector {
  id: string;
  values: number[] | readonly number[];
  metadata?: Record<string, unknown>;
}

export interface VectorizeIndex {
  query(
    vector: number[] | readonly number[],
    options?: {
      topK?: number;
      returnMetadata?: boolean | 'none' | 'indexed' | 'all';
      filter?: Record<string, unknown>;
      namespace?: string;
    },
  ): Promise<VectorizeQueryResult>;
  upsert(vectors: VectorizeVector[]): Promise<{ count?: number } | unknown>;
  deleteByIds?(ids: string[]): Promise<unknown>;
}

// --- KV -------------------------------------------------------------------

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

// Historical alias used by the ingestion package. See note on D1DatabaseLike.
export type KVNamespaceLike = KVNamespace;

// --- Durable Objects ------------------------------------------------------

export interface DurableObjectStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
  waitUntil(promise: Promise<unknown>): void;
}
