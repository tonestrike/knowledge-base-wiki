// Minimal Cloudflare runtime shape used by the chat package's DO adapters.
// We don't import @cloudflare/workers-types to keep the package light; the
// production build wires real CF types from `apps/api`, and tests stub these
// directly. Mirrors `packages/domains/wiki/src/infrastructure/cf-types.ts`.

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
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
