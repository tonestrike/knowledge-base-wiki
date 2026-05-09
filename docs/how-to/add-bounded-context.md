# How to add a new bounded context

Adding a context is a deliberate act. Don't do it casually — each context is a separate package, a separate glossary, and a separate boundary in the type system. Reach for it when:

- A new term is meaningful in your model and doesn't fit any existing context's glossary
- An existing context is starting to fork into two distinct vocabularies (split it)

## Table of contents

1. [Name it](#1-name-it)
2. [Scaffold the package](#2-scaffold-the-package)
3. [Author the glossary](#3-author-the-glossary)
4. [Update the context map](#4-update-the-context-map)
5. [Wire into the api router](#5-wire-into-the-api-router)
6. [Verify](#6-verify)

## 1. Name it

The context name IS a glossary term. Use the noun that captures what's distinct about this part of the model. Avoid generic words (`utils`, `common`, `core` — `core` is taken; if your candidate is generic, you probably haven't found the boundary yet).

For this guide, assume we're adding `forum` — comments, posts, votes.

## 2. Scaffold the package

```
packages/domains/forum/
  package.json
  tsconfig.json
  glossary.md
  README.md
  .cspell/glossary.txt
  src/
    index.ts                  # re-exports interface/
    domain/                   # entities, value objects, events
    application/              # use-cases
    infrastructure/           # adapters
    interface/index.ts        # oRPC router (the only place @orpc/server is imported)
```

`package.json`:

```jsonc
{
  "name": "@domain/forum",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./interface": "./src/interface/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  },
  "dependencies": {
    "@orpc/server": "^1.14.2",
    "@package/contracts": "workspace:*",
    "@package/shared-kernel": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "@types/bun": "^1.2.18",
    "typescript": "^5.7.2"
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "@tooling/tsconfig/base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src/**/*"]
}
```

Add a reference to the root `tsconfig.json`:

```json
{ "path": "./packages/domains/forum" }
```

Add an override to `cspell.json`:

```json
{
  "dictionaryDefinitions": [
    { "name": "forum-glossary", "path": "./packages/domains/forum/.cspell/glossary.txt", "addWords": false }
  ],
  "overrides": [
    {
      "filename": "packages/domains/forum/**",
      "dictionaries": ["tenex-shared", "forum-glossary"]
    }
  ]
}
```

## 3. Author the glossary

`packages/domains/forum/glossary.md`:

```markdown
# forum — ubiquitous language

## Terms

| Term | Definition | Notes |
|---|---|---|
| Member | An identified participant in the forum. | Distinct from `User` in identity context — a Member exists only inside the forum. |
| Post | A top-level contribution. | Always has an author (Member). |
| Comment | A reply attached to a Post or another Comment. | |
| Vote | A signed integer (+1, -1) cast by a Member on a Post or Comment. | Idempotent per-Member-per-target. |

## Banned synonyms

| Don't write | Write |
|---|---|
| user | Member |
| article, entry | Post |
| reply, response | Comment |
| upvote, downvote | Vote (with sign) |
```

`.cspell/glossary.txt`:

```
Member
Post
Comment
Vote
upvote
downvote
```

## 4. Update the context map

In `docs/ubiquitous-language.md`, add a row:

| Context | Path | Owns terms about |
|---|---|---|
| forum | `packages/domains/forum/` | Member, Post, Comment, Vote |

If a term in `forum` overlaps with another context (e.g. `User` in identity vs `Member` in forum), add a cross-reference row in the same file.

## 5. Wire into the api router

In `apps/api/package.json`, add:

```json
"@domain/forum": "workspace:*"
```

In `apps/api/src/router.ts`:

```ts
import { coreRouter } from '@domain/core/interface';
import { forumRouter } from '@domain/forum/interface';

export const router = {
  core: coreRouter,
  forum: forumRouter,
};
```

In `packages/contracts/src/index.ts`, splice the forum contract into the root contract.

## 6. Verify

```sh
bun install
bun run check
```

If `cspell` errors with an unknown word, you used a term that's not in either the shared dict or the new glossary — add it (consciously) and re-run.
