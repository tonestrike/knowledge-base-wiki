import type { SourceStorage } from '../application/ports.ts';
import type { Outline } from '../domain/outline.ts';
import type { R2BucketLike } from './cloudflare-bindings.ts';

const rawKey = (sourceId: string) => `sources/${sourceId}/raw`;
const textKey = (sourceId: string) => `sources/${sourceId}/text`;
const outlineKey = (sourceId: string) => `sources/${sourceId}/outline.json`;
const pageKey = (sourceId: string, n: number) => `sources/${sourceId}/pages/${n}.png`;

export const createR2SourceStorage = (bucket: R2BucketLike): SourceStorage => ({
  async putRaw({ sourceId, bytes }) {
    await bucket.put(rawKey(sourceId), bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
  },
  async putText({ sourceId, text }) {
    await bucket.put(textKey(sourceId), text, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
  },
  async putOutline({ sourceId, outline }) {
    await bucket.put(outlineKey(sourceId), JSON.stringify(outline), {
      httpMetadata: { contentType: 'application/json' },
    });
  },
  async putPageImage({ sourceId, pageNumber, png }) {
    await bucket.put(pageKey(sourceId, pageNumber), png, {
      httpMetadata: { contentType: 'image/png' },
    });
  },
  async getText({ sourceId }) {
    const o = await bucket.get(textKey(sourceId));
    return o ? await o.text() : null;
  },
  async getOutline({ sourceId }) {
    const o = await bucket.get(outlineKey(sourceId));
    if (!o) return null;
    return JSON.parse(await o.text()) as Outline;
  },
});
