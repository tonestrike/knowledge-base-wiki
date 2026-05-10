import type { SourceTextReader } from '../application/ports.ts';

// Minimal R2 binding shape (a strict subset of @cloudflare/workers-types). The
// production bucket lives at apps/api's `env.SOURCES` binding; ingestion writes
// extracted plaintext to `sources/{sourceId}/text` and we slice it here.
export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}
export interface R2Object {
  text(): Promise<string>;
}

export const createR2SourceTextReader = (bucket: R2Bucket): SourceTextReader => ({
  async readSlice({ sourceId, byteRange }) {
    const obj = await bucket.get(`sources/${sourceId}/text`);
    if (!obj) return null;
    const text = await obj.text();
    return text.slice(byteRange.start, byteRange.end);
  },
});
