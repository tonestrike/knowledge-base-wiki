# Projects

A **project** is an active body of work that spans multiple PRs and has a clear "done" condition. This directory is where we plan and track them.

## Table of contents

- [What goes here vs. elsewhere](#what-goes-here-vs-elsewhere)
- [Index](#index)
- [Template](#template)
- [Lifecycle](#lifecycle)
- [How agents use this](#how-agents-use-this)

## What goes here vs. elsewhere

| Type | Goes in | Use when |
|---|---|---|
| **Project** | `docs/projects/` | Multi-PR body of work with a clear goal and done condition |
| **Decision** | [`docs/decisions/`](../decisions/README.md) | A non-obvious architectural choice that's hard to reverse |
| **Recipe** | [`docs/how-to/`](../how-to/) | A repeatable procedure (add a procedure, add a context) |
| **Reference** | [`docs/stack/`](../stack/), [`docs/ddd/`](../ddd/) | How something works, not what we're going to do |

Projects are the **active** things; ADRs are the **historical** record of why projects were shaped the way they were. A finished project should produce zero, one, or more ADRs as a side effect.

## Index

| # | Title | Status | Started | Owner |
|---|---|---|---|---|
| [0001](0001-finish-scaffolding.md) | Finish scaffolding | Active | 2026-05-09 | tonyvantur |
| [0002](0002-folder-wiki.md) | folder-wiki | Active | 2026-05-09 | tonyvantur |

When you add a project, append a row here. Status: `Planned` | `Active` | `Done` | `Abandoned`.

## Template

[`_template.md`](_template.md) — copy and rename to `NNNN-short-title.md` (zero-padded sequential).

## Lifecycle

```
  Planned ──▶ Active ──▶ Done
                 │
                 └────▶ Abandoned (with brief note in the doc)
```

- **Planned**: doc exists, nothing started yet.
- **Active**: at least one slice is in flight.
- **Done**: all slices shipped; status line updated to `Done` with the date and the final commit/PR.
- **Abandoned**: explain why in the doc; keep the file as a record of what we tried.

Don't delete project docs. They become the institutional memory of what was attempted.

## How agents use this

Two skills (declared in [`../ai-tooling/plugins.md`](../ai-tooling/plugins.md)) produce documents in this format:

- `to-prd` — turns a conversation into a project doc (goal, why, scope, slices)
- `to-issues` — breaks a project doc into vertical-slice GitHub issues, one per slice

When you run `claude` or Codex in this repo and ask "plan X", these skills will draft into `docs/projects/`. Author manually with [`_template.md`](_template.md) when you don't want to launch a skill session.

For agent-driven execution of an existing project, point the agent at the file: "execute slice 2 of `docs/projects/0001-finish-scaffolding.md`" works as a brief.
