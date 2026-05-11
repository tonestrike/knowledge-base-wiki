import type { R2Bucket } from '@package/shared-kernel';
import type { SourceTextReader } from '../application/ports.ts';

// The production bucket lives at apps/api's `env.SOURCES` binding; ingestion
// writes extracted plaintext to `sources/{sourceId}/text` and we slice it here.
export const createR2SourceTextReader = (bucket: R2Bucket): SourceTextReader => ({
  async readSlice({ sourceId, byteRange }) {
    const obj = await bucket.get(`sources/${sourceId}/text`);
    if (!obj) return null;
    const text = await obj.text();
    return text.slice(byteRange.start, byteRange.end);
  },
});
