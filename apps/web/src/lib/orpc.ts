import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { Contract } from '@package/contracts';

const link = new RPCLink({
  url: `${typeof window === 'undefined' ? '' : window.location.origin}/rpc`,
  // The signed `tenex_sid` session cookie is HttpOnly + same-origin; the
  // browser only attaches it to `fetch` when `credentials: 'include'` is
  // set. Without this every /rpc/* request lands on the api as anonymous
  // (no session), so listFolders flips back to 401 even immediately after
  // a successful Drive OAuth roundtrip.
  fetch: (request, init) => fetch(request, { ...init, credentials: 'include' }),
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
