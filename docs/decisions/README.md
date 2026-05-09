# Architecture Decision Records

ADRs capture decisions that aren't obvious from the code, with the reasoning that led to them. The point: future-you (or future-agent) can read why we chose X without re-deriving the tradeoffs.

## Table of contents

- [When to write an ADR](#when-to-write-an-adr)
- [Index](#index)
- [Template](#template)

## When to write an ADR

Write one when:

- The decision was non-obvious — there were multiple defensible options.
- The decision is hard to reverse — undoing it would take more than a day.
- Future readers will likely ask "why did they do it this way?"

Don't write one for trivia (file naming, code style — that lives in `.rulesync/rules/`).

## ADR vs. Project vs. How-to

Easy to conflate; the distinction:

- **ADR** (here) — *why* we made a decision. Historical, immutable once accepted (supersede with a new ADR).
- **Project** ([`../projects/`](../projects/README.md)) — *what* we're actively doing. Living until done.
- **How-to** ([`../how-to/`](../how-to/)) — *how* to repeatedly perform a task. Procedure.

A finished project often produces ADRs as a side effect (the decisions made along the way).

## Index

| # | Title | Date | Status |
|---|---|---|---|
| [0001](0001-stack-choice.md) | Stack choice | 2026-05-09 | Accepted |
| [0002](0002-web-deploy-target.md) | Web deploy target | 2026-05-09 | Accepted |

When you add an ADR, append a row here.

## Template

Save as `docs/decisions/NNNN-short-title.md` (zero-padded, sequential).

```markdown
# NNNN — Short Title

**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded by NNNN | Deprecated
**Deciders:** <names>

## Context

What forced the decision? What constraints applied? What were we already doing?

## Options considered

- **Option A** — pros, cons
- **Option B** — pros, cons
- **Option C** — pros, cons

## Decision

Which option, and why specifically that one.

## Consequences

What this commits us to. What it forecloses. What we'll need to revisit if X changes.
```

## Examples of decisions worth recording (when they happen)

- Choosing between Drizzle / Prisma / raw SQL for D1
- Whether to do CQRS in any bounded context
- Authentication mechanism (Auth.js / Clerk / WorkOS / custom)
- Whether to introduce a job queue, and which
- API versioning strategy (path / header / contract evolution)
- Frontend state management beyond React Query, if it ever becomes necessary
