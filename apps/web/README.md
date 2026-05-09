# @app/web

Vite + React 19 + React Query. Consumes oRPC contracts from `@package/contracts` via `createORPCClient`.

## Dev

```sh
bun --filter @app/api dev    # start the API on :8787
bun --filter @app/web dev    # vite on :5173, /rpc proxied to :8787
```

## Adding a new query

```tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { orpc } from './lib/orpc.ts';

const things = useQuery(orpc.<context>.<procedure>.queryOptions({ input: {...} }));
const create = useMutation(orpc.<context>.<procedure>.mutationOptions());
```

`orpc` is generated from the contract type — autocomplete and type-checking light up automatically as new procedures land in `packages/contracts`.
