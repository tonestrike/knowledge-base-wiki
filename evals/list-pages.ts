import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { WikiId } from '@package/contracts/shared';
const link = new RPCLink({ url: 'https://api.tenex.localhost:1355/rpc' });
const client = createORPCClient(link) as ContractRouterClient<Contract>;
const wikis = await client.wiki.listWikis({ limit: 1 });
const wiki = wikis.items[0];
if (!wiki) {
  throw new Error('no wikis found — compile a folder first');
}
const pages = await client.wiki.listPages({ wikiId: wiki.id as WikiId, limit: 50 });
for (const p of pages.items)
  console.log(`  ${p.subtype.padEnd(7)} ${(p.pageType ?? '').padEnd(11)} ${p.title}`);
