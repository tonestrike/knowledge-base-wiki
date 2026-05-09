# Bounded contexts

A bounded context is a part of the model where a term has ONE specific meaning. The boundary is enforced by the package boundary in our monorepo.

## Table of contents

- [Why bounded contexts](#why-bounded-contexts)
- [What goes in one](#what-goes-in-one)
- [What does NOT go in one](#what-does-not-go-in-one)
- [Adding a new context](#adding-a-new-context)
- [Splitting a context](#splitting-a-context)

## Why bounded contexts

A flat model leads to one of two failures:

- **God objects.** "User" means everything to everyone — auth, profile, billing, social graph — and grows until no change is local.
- **Synonyms everywhere.** Subtly-different things share a name (`Item` in inventory and `Item` in cart) and cause integration bugs every time their meanings drift.

Bounded contexts let `User` in identity be a different type from `Member` in forum, with explicit translation between them. Each context has its own glossary; the same word can mean different things across contexts and that's fine.

## What goes in one

A context owns:

- **A glossary** (`glossary.md`) — the canonical names for everything in this part of the model.
- **A cspell dict** (`.cspell/glossary.txt`) — enforces the glossary; `addWords: false` means new terms must be added deliberately in PRs.
- **Aggregates and value objects** (`src/domain/`) — the objects whose names are in the glossary.
- **Use-cases** (`src/application/`) — the verbs in the glossary, as pure functions.
- **Adapters** (`src/infrastructure/`) — implementations of repository interfaces, external clients.
- **An interface** (`src/interface/`) — oRPC procedure handlers, the only outward-facing surface.

See [layering.md](layering.md) for what goes in each layer.

## What does NOT go in one

- **Cross-context types.** If a type is shared by two contexts, either (a) the contexts are actually one and should merge, or (b) one context owns it and the other gets a translated copy. Translation lives at the interface layer.
- **Generic helpers.** Things like `Result`, `Id`, `Clock` go in `@package/shared-kernel`, deliberately small.
- **Framework code.** Hono, oRPC, Cloudflare types are forbidden in `domain/` and `application/`. They live in `interface/`.

## Adding a new context

See [`../how-to/add-bounded-context.md`](../how-to/add-bounded-context.md) for the mechanical steps. The decision to add one comes first; the mechanics are bookkeeping.

## Splitting a context

If a context's glossary is starting to fork — two distinct vocabularies inside one folder — that's the signal to split. Process:

1. Write down both candidate glossaries on paper.
2. Look at every type and ask: which glossary does this belong to? If most types fit cleanly, split.
3. Pick names. The pre-split context name often becomes one of the new contexts; the other gets a fresh name.
4. Move types one at a time, using the type system as your guide.
5. Decide what shared events / contracts the two contexts need to coordinate. Put those in `@package/contracts` (sync) or `@package/shared-kernel` (events).
