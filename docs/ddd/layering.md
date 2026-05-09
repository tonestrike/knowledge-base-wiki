# Layering inside a context

Each `packages/domains/<ctx>/` package has the same internal structure. The layers exist to keep dependencies pointing one way: from the outside in.

## Table of contents

- [The layers](#the-layers)
- [Dependency direction](#dependency-direction)
- [Where everything goes](#where-everything-goes)
- [Examples](#examples)

## The layers

```
src/
  domain/           # entities, value objects, domain events
  application/      # use-cases (pure functions)
  infrastructure/   # adapters — repository implementations, external clients
  interface/        # oRPC procedure handlers — the only outward-facing surface
```

## Dependency direction

```
interface/  →  application/  →  domain/
                ▲
infrastructure/ ─┘  (adapters injected into use-cases at runtime)
```

Inversions:

- `application/` depends on `domain/` types and on **interfaces** (TypeScript interfaces) for repositories. It does NOT depend on `infrastructure/` directly.
- `infrastructure/` depends on `domain/` types and **implements** the interfaces that `application/` declares.
- `interface/` depends on `application/` (calls use-cases) and on `@orpc/server` (which is forbidden in any other layer).

This is the standard "ports and adapters" / "hexagonal" arrangement.

## Where everything goes

| Goes in `domain/` | Examples |
|---|---|
| Aggregate roots | `Post`, `Member`, `Vote` |
| Value objects | `EmailAddress`, `Score`, `Slug` |
| Domain events | `PostCreated`, `VoteCast` |
| Type-narrowing predicates on the above | `isPublishedPost(post)` |

| Goes in `application/` | Examples |
|---|---|
| Use-case functions | `createPost(deps, input)`, `castVote(deps, input)` |
| Use-case input/output types | `CreatePostInput`, `CreatePostOutput` |
| Repository interfaces (TypeScript types) | `PostRepo`, `VoteRepo` |
| Tests for use-cases | `create-post.test.ts` |

| Goes in `infrastructure/` | Examples |
|---|---|
| Repository implementations | `D1PostRepo`, `KvSessionStore` |
| External-API clients | `StripeClient`, `SlackNotifier` |
| Drizzle schema files | `schema.ts` |

| Goes in `interface/` | Examples |
|---|---|
| oRPC procedure handlers | `os.create.handler(({ input, context }) => createPost(...))` |
| Auth middleware composition | `requireAuth(context)` calls |
| ORPCError mapping | `throw new ORPCError('NOT_FOUND', ...)` |

## Examples

### A use-case (`application/create-post.ts`)

```ts
import type { Clock } from '@package/shared-kernel';
import type { Post } from '../domain/post.ts';

export interface PostRepo {
  save(post: Post): Promise<void>;
}

export interface CreatePostDeps {
  clock: Clock;
  repo: PostRepo;
}

export interface CreatePostInput {
  authorId: string;
  title: string;
  body: string;
}

export const createPost = async (
  { clock, repo }: CreatePostDeps,
  { authorId, title, body }: CreatePostInput,
): Promise<Post> => {
  const post: Post = {
    id: crypto.randomUUID(),
    authorId,
    title,
    body,
    createdAt: clock.now(),
  };
  await repo.save(post);
  return post;
};
```

Note: pure function, no Hono / oRPC / Cloudflare. Trivially testable.

### An adapter (`infrastructure/d1-post-repo.ts`)

```ts
import type { Post } from '../domain/post.ts';
import type { PostRepo } from '../application/create-post.ts';

export const d1PostRepo = (db: D1Database): PostRepo => ({
  async save(post: Post) {
    await db.prepare('INSERT INTO posts (id, author_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(post.id, post.authorId, post.title, post.body, post.createdAt.toISOString())
      .run();
  },
});
```

The adapter implements `PostRepo`, the interface declared in `application/`. The use-case never imports from `infrastructure/`.

### A handler (`interface/index.ts`)

```ts
import { implement } from '@orpc/server';
import { postsContract } from '@package/contracts/forum';
import { createPost } from '../application/create-post.ts';

const os = implement(postsContract).$context<ForumRequestContext>();

export const forumRouter = {
  create: os.create.handler(({ input, context }) =>
    createPost({ clock: context.clock, repo: context.repo }, input),
  ),
};
```

The handler unpacks context, calls the use-case, returns the result. No business logic.
