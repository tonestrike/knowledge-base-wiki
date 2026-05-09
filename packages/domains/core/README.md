# @domain/core

The **core** bounded context. Cross-cutting primitives that don't belong to any feature-specific context: health checks, diagnostics.

## Layout

```
src/
  domain/           # value objects, entities, domain events
  application/      # use-cases — pure functions, deps injected
  infrastructure/   # adapters (repository impls, external clients)
  interface/        # oRPC procedure handlers — the only place this package
                    # talks to the outside world
glossary.md         # ubiquitous language — single source of truth
.cspell/            # cspell dict; addWords:false enforces glossary edits in PR
```

## Rules

1. **No imports from other `domains/*` packages.** Cross-context coordination goes through `@package/contracts` (the seam) or `@package/shared-kernel` (small, deliberate primitives).
2. **`domain/` and `application/` are framework-free.** No Hono, no oRPC, no Cloudflare types. They take dependencies via interfaces (`Clock`, `Repo`, etc.) so they're trivially testable.
3. **`interface/` is the only layer that imports `@orpc/server`.** It implements the contract from `@package/contracts/core` and delegates to use-cases in `application/`.
4. **Adding a term that isn't in `glossary.md` will fail cspell.** Add the term to both files in the same PR; force a moment of thought about whether it belongs.
