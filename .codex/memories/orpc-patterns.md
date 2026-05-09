# oRPC patterns

## Defining a contract

```ts
// packages/contracts/src/<context>/<resource>.ts
import { oc } from '@orpc/contract';
import { z } from 'zod';

export const <resource>Contract = {
  list: oc
    .route({ method: 'GET', path: '/<resource>' })
    .input(z.object({ limit: z.coerce.number().int().positive().max(100).default(20) }))
    .output(z.object({ items: z.array(<Schema>), nextCursor: z.string().optional() })),

  get: oc
    .route({ method: 'GET', path: '/<resource>/{id}' })
    .input(z.object({ id: z.string().uuid() }))
    .output(<Schema>),

  create: oc
    .route({ method: 'POST', path: '/<resource>' })
    .input(<Schema>.omit({ id: true, createdAt: true }))
    .output(<Schema>),
};
```

GET inputs use `z.coerce.*` — query strings are always strings.

## Composing context contracts

```ts
// packages/contracts/src/<context>/index.ts
export const <context>Contract = {
  ...<resourceA>Contract,
  ...<resourceB>Contract,
};
```

Then re-export at `packages/contracts/src/index.ts`.

## Implementing a procedure

```ts
// packages/domains/<context>/src/interface/index.ts
import { implement } from '@orpc/server';
import { <context>Contract } from '@package/contracts/<context>';
import { <useCase> } from '../application/<use-case>.ts';

export interface <Context>RequestContext {
  clock: Clock;
  // db, auth, etc.
}

const os = implement(<context>Contract).$context<<Context>RequestContext>();

export const <context>Router = {
  list: os.list.handler(({ input, context }) => <useCase>(context, input)),
};
```

`os.<procedureName>.handler` enforces contract shape at compile time. The handler delegates to a pure use-case in `application/`; the handler does not contain logic.

## Consuming on the frontend

```ts
// apps/web/src/lib/orpc.ts (already exists)
import type { Contract } from '@package/contracts';

// In components:
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '../lib/orpc.ts';

const list = useQuery(orpc.<context>.list.queryOptions({ input: { limit: 20 } }));

const create = useMutation({
  ...orpc.<context>.create.mutationOptions(),
  onSuccess: () => qc.invalidateQueries(orpc.<context>.list.queryFilter()),
});
```

## Errors

Throw typed errors from use-cases. Map to oRPC errors at the interface layer:

```ts
import { ORPCError } from '@orpc/server';

handler(({ input }) => {
  const result = useCase(input);
  if (!result.ok) {
    throw new ORPCError('NOT_FOUND', { message: result.error.message });
  }
  return result.value;
});
```