import type { WikiPageId } from '@package/contracts/shared';
import type { R2Bucket } from './cf-types.ts';

const key = (id: WikiPageId): string => `wiki_pages/${id}.md`;

export interface WikiPageBodyStorage {
  put(id: WikiPageId, body: string): Promise<void>;
  get(id: WikiPageId): Promise<string | null>;
  // SF2 — used to roll back tentative bodies when the D1 batch fails.
  delete(id: WikiPageId): Promise<void>;
}

export const createR2WikiPageStorage = (bucket: R2Bucket): WikiPageBodyStorage => ({
  async put(id, body) {
    await bucket.put(key(id), body, { httpMetadata: { contentType: 'text/markdown' } });
  },
  async get(id) {
    const o = await bucket.get(key(id));
    return o ? await o.text() : null;
  },
  async delete(id) {
    await bucket.delete(key(id));
  },
});
