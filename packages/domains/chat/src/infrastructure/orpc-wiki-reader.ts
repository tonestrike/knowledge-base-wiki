import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { WikiPageId } from '@package/contracts/shared';
import type { WikiPageSummary, WikiReader } from '../application/ports.ts';

export interface OrpcWikiReaderOptions {
  /** Full URL of the api's oRPC mount, e.g. https://api.tenex.dev/rpc. */
  rpcUrl: string;
  /** Optional fetch override (Cloudflare worker fetch, test fetch, etc.). */
  fetch?: typeof fetch;
  /** Headers (e.g. auth) merged into every request. */
  headers?: Record<string, string>;
  /** Pagination cap for substring-ranking the candidate set. */
  pageScanLimit?: number;
}

const tokenize = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);

const score = (p: WikiPageSummary, q: string): number => {
  let s = 0;
  for (const t of tokenize(q)) {
    if (p.title.toLowerCase().includes(t)) s += 5;
    if (p.body.toLowerCase().includes(t)) s += 1;
  }
  return s;
};

/**
 * Cross-context wiki reader: chat asks the api for `WikiPage`s through the
 * typed oRPC client. The chat domain never imports from `@domain/wiki` — it
 * only knows the contract.
 *
 * Search is local: we page through `wiki.listPages` and rank by substring
 * match. A phase-3 follow-up can swap in a real `wiki.searchPages` procedure;
 * the chat side won't notice.
 */
export const createOrpcWikiReader = (opts: OrpcWikiReaderOptions): WikiReader => {
  const link = new RPCLink({
    url: opts.rpcUrl,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
  const client = createORPCClient(link) as unknown as ContractRouterClient<Contract>;

  return {
    async searchPages({ wikiId, query, limit }) {
      const out: WikiPageSummary[] = [];
      let cursor: string | undefined;
      const cap = opts.pageScanLimit ?? 200;
      while (out.length < cap) {
        const page = await client.wiki.listPages({ wikiId, limit: 100, cursor });
        for (const p of page.items) {
          if (out.length >= cap) break;
          out.push({
            id: p.id,
            wikiId: p.wikiId,
            title: p.title,
            ...(p.pageType !== undefined ? { pageType: p.pageType } : {}),
            body: p.body,
            citations: p.citations,
          });
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return out
        .map((p) => ({ p, s: score(p, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.p);
    },
    async getPage(id: WikiPageId) {
      const p = await client.wiki.getPage({ id });
      return {
        id: p.id,
        wikiId: p.wikiId,
        title: p.title,
        ...(p.pageType !== undefined ? { pageType: p.pageType } : {}),
        body: p.body,
        citations: p.citations,
      };
    },
  };
};
