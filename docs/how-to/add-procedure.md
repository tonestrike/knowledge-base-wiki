# How to add a new oRPC procedure

End-to-end: contract → use-case → handler → frontend hook. Follow this exactly; the type system carries you through.

## Table of contents

1. [Decide the bounded context](#1-decide-the-bounded-context)
2. [Define the contract](#2-define-the-contract)
3. [Write the use-case](#3-write-the-use-case)
4. [Wire the procedure handler](#4-wire-the-procedure-handler)
5. [Consume on the frontend](#5-consume-on-the-frontend)
6. [Verify](#6-verify)

## 1. Decide the bounded context

Which `packages/domains/<ctx>/` does this belong to? If none feels right, the procedure may need a new context — see [add-bounded-context.md](add-bounded-context.md).

Confirm every term you'll use is in the context's `glossary.md` AND `.cspell/glossary.txt`. If not, add them in this same PR.

## 2. Define the contract

In `packages/contracts/src/<ctx>/<resource>.ts`:

```ts
import { oc } from '@orpc/contract';
import { z } from 'zod';

const Item = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime(),
});

export const itemsContract = {
  list: oc
    .route({ method: 'GET', path: '/items' })
    .input(z.object({
      limit: z.coerce.number().int().positive().max(100).default(20),
    }))
    .output(z.object({ items: z.array(Item) })),

  create: oc
    .route({ method: 'POST', path: '/items' })
    .input(Item.omit({ id: true, createdAt: true }))
    .output(Item),
};
```

GET inputs use `z.coerce.*` — query strings are always strings.

If `<ctx>` already has a contract index file, splice your sub-contract in:

```ts
// packages/contracts/src/<ctx>/index.ts
export const <ctx>Contract = {
  ...existingContract,
  ...itemsContract,
};
```

## 3. Write the use-case

In `packages/domains/<ctx>/src/application/<verb>-<noun>.ts`. Pure function, dependencies injected:

```ts
import type { Clock } from '@package/shared-kernel';
import type { ItemRepo } from '../infrastructure/item-repo.ts';

export interface ListItemsDeps {
  clock: Clock;
  repo: ItemRepo;
}

export interface ListItemsInput {
  limit: number;
}

export const listItems = async (
  { repo }: ListItemsDeps,
  { limit }: ListItemsInput,
) => {
  const items = await repo.list({ limit });
  return { items };
};
```

No Hono, no oRPC, no Cloudflare types in this file. That's the rule.

Write a unit test alongside it: `<verb>-<noun>.test.ts`.

## 4. Wire the procedure handler

In `packages/domains/<ctx>/src/interface/index.ts`:

```ts
import { implement } from '@orpc/server';
import { <ctx>Contract } from '@package/contracts/<ctx>';
import { listItems } from '../application/list-items.ts';

const os = implement(<ctx>Contract).$context<<Ctx>RequestContext>();

export const <ctx>Router = {
  // ... existing handlers
  list: os.list.handler(({ input, context }) =>
    listItems({ clock: context.clock, repo: context.repo }, input),
  ),
};
```

The handler is the only place `@orpc/server` is allowed. It contains zero logic — just unpacks context and delegates.

## 5. Consume on the frontend

In `apps/web` (anywhere — typed across the contract):

```tsx
import { useQuery } from '@tanstack/react-query';
import { orpc } from '../lib/orpc.ts';

const items = useQuery(orpc.<ctx>.list.queryOptions({ input: { limit: 20 } }));
```

For mutations:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/orpc.ts';

const qc = useQueryClient();
const create = useMutation({
  ...orpc.<ctx>.create.mutationOptions(),
  onSuccess: () => qc.invalidateQueries(orpc.<ctx>.list.queryFilter()),
});
```

## 6. Verify

```sh
bun run check
```

If the contract changes, both server and client get a type error simultaneously — fix both, then re-run.
