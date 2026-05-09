# How to start a new project

When the work is bigger than a single PR and worth tracking explicitly, it gets a project doc under `docs/projects/`. This how-to describes the process from "I want to build X" to "the project doc is committed and ready for slice execution."

If you're routed here from the `monorepo` skill, follow the steps verbatim.

## Table of contents

1. [Phase 1 — Grill](#phase-1--grill)
2. [Phase 2 — Draft](#phase-2--draft)
3. [Phase 3 — Index](#phase-3--index)
4. [Phase 4 — Stop](#phase-4--stop)
5. [What good looks like](#what-good-looks-like)
6. [Failure modes](#failure-modes)

## Phase 1 — Grill

Do not write the project doc yet. Ask the user clarifying questions until the goal is unambiguous. At minimum, you must be able to answer these in one sentence each:

- **Goal** — what does success look like at the end of this project?
- **Why now** — what forced the timing? What's the cost of NOT doing it?
- **Out of scope** — what we're explicitly NOT doing, even if tempting?
- **Bounded contexts** — which existing contexts does this project touch? Does it create new ones? If new, what vocabulary do they own (per [`../ddd/bounded-contexts.md`](../ddd/bounded-contexts.md) and [`../ddd/linguistic-discipline.md`](../ddd/linguistic-discipline.md))?
- **Demo / shipping moment** — what concrete moment makes this project "real"? If you can't name one, the project is aspirational, not active.
- **Dependencies on other projects** — most projects depend on `0001-finish-scaffolding.md` (CI, secrets, deploy targets). Surface those.

Don't ask all of them at once. Ask what's most ambiguous first. If an answer surfaces a deeper question, follow the thread. Stop when you can repeat the goal back in one sentence and the user agrees without amendment.

The skill `grill-me` (Pocock's, if installed) encodes this loop natively. Use it if available.

## Phase 2 — Draft

Once the goal is locked, draft:

```
docs/projects/NNNN-<short-title>.md
```

`NNNN` is one greater than the highest number in [`../projects/README.md`](../projects/README.md)'s index. Use [`../projects/_template.md`](../projects/_template.md) verbatim — every section heading must match.

Mandatory content:

- **Goal** (one sentence)
- **Why now** (the trigger; what's at stake if we wait)
- **Out of scope** (with a 1-line rationale per item)
- **Open questions** (with deciders + by-when)
- **Slices** — each one shippable as a single PR. Each slice has:
  - Why it exists
  - Done-when criteria as a checklist (be specific)
  - Depends on (other slices, other projects)
  - Estimate (S/M/L, rough)
- **Dependencies** (external + internal)
- **Risks** with mitigations
- **Notes** (suggested order, links, anything else)

Required cross-references:

- Mention the bounded contexts the project will create or modify
- If the project produces ADRs, pre-flag which slice produces which ADR
- If the project depends on a slice of another project (most commonly `0001-finish-scaffolding.md`), name it explicitly

If you cannot write a slice's done-criteria as a checklist with at least 3 items, the slice is too vague — sharpen it or split it.

## Phase 3 — Index

Add a row to [`../projects/README.md`](../projects/README.md)'s index:

| # | Title | Status | Started | Owner |
|---|---|---|---|---|
| [NNNN](NNNN-short-title.md) | <short title> | Active | YYYY-MM-DD | <handle> |

## Phase 4 — Stop

Do NOT start implementing any slice. Surface the draft to the user with one of these prompts:

- "Project doc landed at `docs/projects/NNNN-<title>.md`. Review and tell me which slice to start with."
- "Three open questions still need your call before any slice is shippable: Q1, Q2, Q3."

The user comes back with a slice-execution prompt; that hands off to [`execute-slice.md`](execute-slice.md).

## What good looks like

[`../projects/0001-finish-scaffolding.md`](../projects/0001-finish-scaffolding.md) and [`../projects/0002-folder-wiki.md`](../projects/0002-folder-wiki.md) are working examples. Read both before drafting your first one. Note in particular:

- 0001 has 7 slices; 0002 has 10. Both are right because they match the project's actual surface area.
- Open questions reference deciders by name and timing by slice.
- Each slice's "Done when" is specific enough that two readers would agree on whether it's done.
- "Out of scope" is opinionated — it includes things that are tempting and would absorb infinite time.
- The "Notes" section in both gives a suggested order with reasoning.

## Failure modes

| Failure | Cause | Fix |
|---|---|---|
| Project doc is vague; slices read like "build the thing" | Skipped Phase 1 grilling | Don't write the doc until the goal is one unambiguous sentence |
| A slice depends on something that doesn't exist | Didn't surface dependencies during grilling | Add a "Depends on: <prerequisite>" line; create a slice or ADR for the prerequisite if needed |
| Out-of-scope is empty | Author hasn't been honest with themselves | List the things you'd love to add; the act of listing forces the cut |
| Demo moment can't be named | Project is aspirational, not active | Move to Status: Planned; come back when the trigger materializes |
| Slices aren't shippable on their own | Author thought in features, not vertical cuts | Split each "feature slice" into the smallest end-to-end thing that demonstrates value |
