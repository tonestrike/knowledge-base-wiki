import type { Claim, WikiId, WikiPageId } from '@package/contracts/shared';
import type { ClaimReader } from '../application/ports.ts';

// Minimal cross-context client interface — verification reads Claims and Wiki
// IDs through the wiki context's oRPC router. Defined as a structural type so
// the verification domain doesn't import @domain/wiki (cross-domain imports are
// banned). The interface mirrors the wiki contract's listPages/listWikis
// procedures; apps/api wires a concrete oRPC client at composition time.
export interface WikiOrpcClient {
  wiki: {
    listWikis(input: {
      cursor?: string;
      limit: number;
    }): Promise<{ items: ReadonlyArray<{ id: WikiId }>; nextCursor?: string }>;
    listPages(input: {
      wikiId: WikiId;
      cursor?: string;
      limit: number;
    }): Promise<{
      items: ReadonlyArray<{ id: WikiPageId; claims: ReadonlyArray<Claim> }>;
      nextCursor?: string;
    }>;
  };
}

export interface OrpcClaimReaderOptions {
  client: WikiOrpcClient;
  pageBatchSize?: number;
  wikiBatchSize?: number;
}

export const createOrpcClaimReader = ({
  client,
  pageBatchSize = 100,
  wikiBatchSize = 50,
}: OrpcClaimReaderOptions): ClaimReader => ({
  async listClaimsForWiki(wikiId: WikiId) {
    const out: Array<{ wikiPageId: WikiPageId; claim: Claim }> = [];
    let cursor: string | undefined;
    while (true) {
      const page = await client.wiki.listPages({ wikiId, limit: pageBatchSize, cursor });
      for (const p of page.items) {
        for (const claim of p.claims) {
          out.push({ wikiPageId: p.id, claim });
        }
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  },

  async listWikiIds() {
    const out: WikiId[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await client.wiki.listWikis({ limit: wikiBatchSize, cursor });
      for (const w of page.items) out.push(w.id);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  },
});
