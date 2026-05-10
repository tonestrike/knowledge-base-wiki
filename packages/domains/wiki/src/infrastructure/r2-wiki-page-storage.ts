import type { WikiPageId } from '@package/contracts/shared';
import type { R2Bucket } from './cf-types.ts';

const key = (id: WikiPageId): string => `wiki_pages/${id}.md`;

export interface WikiPageBodyStorage {
  put(id: WikiPageId, body: string): Promise<void>;
  get(id: WikiPageId): Promise<string | null>;
}

export const createR2WikiPageStorage = (bucket: R2Bucket): WikiPageBodyStorage => ({
  async put(id, body) {
    await bucket.put(key(id), body, { httpMetadata: { contentType: 'text/markdown' } });
  },
  async get(id) {
    const o = await bucket.get(key(id));
    return o ? await o.text() : null;
  },
});
