# oRPC + Hono

Type-safe RPC across the full stack. Server in `apps/api`, client in `apps/web`, contracts in `@package/contracts`.

## Table of contents

- [Why oRPC over tRPC](#why-orpc-over-trpc)
- [Contract authoring](#contract-authoring)
- [Implementing a procedure](#implementing-a-procedure)
- [Frontend consumption](#frontend-consumption)
- [Errors](#errors)
- [Versioning](#versioning)

## Why oRPC over tRPC

- **Contract-first.** Contracts are first-class values you can compose, share, and document — not implicit from server code.
- **OpenAPI-compatible.** A contract emits OpenAPI; non-TS clients work too.
- **MCP / AI-tool generation.** Each procedure can be exposed as an MCP tool — no second definition.
- **Better Hono integration.** First-class fetch handler, no adapter middleware glue.

For step-by-step procedure authoring, see [`../how-to/add-procedure.md`](../how-to/add-procedure.md).

## Contract authoring

Contracts live in `packages/contracts/src/<ctx>/<resource>.ts`:

```ts
import { oc } from '@orpc/contract';
import { z } from 'zod';

const Item = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const itemsContract = {
  list: oc
    .route({ method: 'GET', path: '/items' })
    .input(z.object({ limit: z.coerce.number().int().positive().max(100).default(20) }))
    .output(z.object({ items: z.array(Item) })),

  get: oc
    .route({ method: 'GET', path: '/items/{id}' })
    .input(z.object({ id: z.string().uuid() }))
    .output(Item),
};
```

Composition by spread:

```ts
export const forumContract = {
  ...postsContract,
  ...commentsContract,
  ...votesContract,
};
```

GET inputs use `z.coerce.*` — query strings are always strings.

## Implementing a procedure

In a domain's `src/interface/index.ts`:

```ts
import { implement } from '@orpc/server';
import { forumContract } from '@package/contracts/forum';
import { listPosts } from '../application/list-posts.ts';

export interface ForumRequestContext {
  clock: Clock;
  repo: PostRepo;
}

const os = implement(forumContract).$context<ForumRequestContext>();

export const forumRouter = {
  list: os.list.handler(({ input, context }) =>
    listPosts({ clock: context.clock, repo: context.repo }, input),
  ),
};
```

`os.<procedureName>.handler` enforces contract shape at compile time. The handler is the only place `@orpc/server` is allowed; it has zero logic and delegates to a use-case.

## Frontend consumption

`apps/web/src/lib/orpc.ts` already has the client wired:

```ts
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { Contract } from '@package/contracts';

const link = new RPCLink({ url: '/rpc' });
export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
```

In components:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/orpc.ts';

const list = useQuery(orpc.forum.list.queryOptions({ input: { limit: 20 } }));

const qc = useQueryClient();
const create = useMutation({
  ...orpc.forum.create.mutationOptions(),
  onSuccess: () => qc.invalidateQueries(orpc.forum.list.queryFilter()),
});
```

## Errors

Throw `ORPCError` from handlers. Map domain errors at the interface boundary:

```ts
import { ORPCError } from '@orpc/server';

create: os.create.handler(async ({ input, context }) => {
  const result = await createPost({ clock: context.clock, repo: context.repo }, input);
  if (!result.ok) {
    if (result.error.kind === 'unauthorized') {
      throw new ORPCError('UNAUTHORIZED', { message: 'login required' });
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.error.message });
  }
  return result.value;
});
```

Use-cases return `Result<T, E>` (from `@package/shared-kernel`). Translation to HTTP errors is the interface layer's job.

## Versioning

Default policy: contracts are additive. Add new procedures, mark old ones with a comment if you intend to remove later, never break a procedure shape.

When you DO need a breaking change:

1. Define the new shape under a new procedure name (e.g. `listV2`) — both old and new ship for one release.
2. Migrate the frontend to the new procedure.
3. Remove the old procedure when no caller remains.
4. Write an ADR for the breaking change (see [`../decisions/README.md`](../decisions/README.md)).
