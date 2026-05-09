# DDD — linguistic first

The user cares more about ubiquitous language than about folder structure dogma. The folder structure exists to reinforce the language.

## Bounded contexts

A bounded context is a part of the system where a term has ONE specific meaning. Different contexts can use the same word for different things — that's expected. Context boundaries are explicit:

- One `packages/domains/<context>/` package per bounded context.
- Each context owns its `glossary.md` (the spec) and `.cspell/glossary.txt` (the enforcer).
- Cross-context coordination goes through `@package/contracts` (synchronous calls) or domain events emitted via `@package/shared-kernel` (asynchronous, eventually-consistent).
- Inside a context, layering is `domain/` (entities, value objects, events) → `application/` (use-cases) → `infrastructure/` (adapters) → `interface/` (oRPC handlers).

## Adding a term

NEVER write code that uses a term not in the glossary. Sequence:

1. Find the smallest existing context where the term plausibly belongs.
2. If it doesn't fit any: open a discussion with the user — the term might warrant a new context.
3. Add the term to `glossary.md` with a definition AND a "banned synonyms" entry if relevant.
4. Add the bare word to `.cspell/glossary.txt`.
5. Then write the code.

## Banned synonyms

Each context's `glossary.md` includes a "banned synonyms" table. cspell `flagWords` per-override enforces these. Example: in a `forum/` context, `User` might be banned because the right word is `Member`.

## When two contexts have the same term meaning different things

Don't unify them. Add a "see also" cross-reference in both glossaries so future-you knows there's a different meaning elsewhere. The cross-context map lives in `docs/ubiquitous-language.md`.

## Aggregates and consistency

Inside a context, the aggregate is the consistency boundary. Use cases mutate at most one aggregate per transaction. Cross-aggregate consistency is eventual, via events — never a "transaction across two aggregates" inside one use case.