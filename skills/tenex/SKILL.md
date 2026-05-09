---
name: tenex
description: Use as the entry point whenever the user is starting any task in the tenex monorepo — planning a new project, executing a slice of an existing project, adding a bounded context, adding an oRPC procedure, adding a secret, writing an ADR, or reviewing code. Trigger on phrases like "in tenex", "let's work on", "plan a project", "implement slice", "add a procedure", "add a context", "add an ADR", "add a secret", or any request that touches files under /Users/tonyvantur/Development/projects/tenex/.
---

# tenex — work entry point

This skill is the front door for any task in the tenex repo. It routes intent to the right workflow and reminds you of always-on rules. When you invoke it, you are committing to following the routing below — don't improvise.

## Step 1 — Identify intent

Match what the user wants to ONE of these. If multiple apply, do the earliest one first.

| Intent | Trigger phrasing | Where to go |
|---|---|---|
| **Start a new project** (no project doc exists yet) | "plan a project", "new project", "I want to build X" with no slice in mind | [`docs/how-to/start-a-project.md`](../../docs/how-to/start-a-project.md) |
| **Execute a slice** of an existing project | "implement slice N of …", "let's do …" referring to an existing `docs/projects/NNNN-…md` | [`docs/how-to/execute-slice.md`](../../docs/how-to/execute-slice.md) |
| **Add a bounded context** | "add a context", "scaffold a domain package" | [`docs/how-to/add-bounded-context.md`](../../docs/how-to/add-bounded-context.md) |
| **Add an oRPC procedure** | "add a procedure", "add an endpoint" (translate "endpoint" → procedure per glossary) | [`docs/how-to/add-procedure.md`](../../docs/how-to/add-procedure.md) |
| **Add a secret** | "add a secret", "configure auth", "set up env var X" | [`docs/how-to/add-secret.md`](../../docs/how-to/add-secret.md) |
| **Write an ADR** | "ADR for …", "decision record about …" | [`docs/how-to/add-adr.md`](../../docs/how-to/add-adr.md) |
| **Review code** | "review my changes", "PR review", "look at this branch" | Invoke `pr-review-toolkit:code-reviewer` or `feature-dev:code-reviewer` |
| **Debug / diagnose** | "this is failing", "I'm getting an error", "why does X not work" | Use the `diagnose` skill if installed; otherwise: reproduce → minimize → hypothesize → fix |
| **Explore the codebase** | "how does X work", "where is Y" | Invoke `feature-dev:code-explorer` |
| **Architecture design** for a slice with open questions | "design …", "blueprint for …", anything in `docs/projects/*.md` Slice N where the slice text says "use feature-dev:code-architect" | Invoke `feature-dev:code-architect` |

If no row matches, ASK the user to clarify intent before guessing.

## Step 2 — Always-on rules (apply to every workflow)

These are non-negotiable. The full versions live in [`.rulesync/rules/`](../../.rulesync/rules/) (auto-fanned-out into `CLAUDE.md` and `AGENTS.md`); the bullets below are reminders.

1. **Glossaries before code.** New term in code → add to the relevant context's `glossary.md` AND `.cspell/glossary.txt` IN THE SAME PR. cspell with `addWords: false` enforces this. ([linguistic-discipline.md](../../docs/ddd/linguistic-discipline.md))
2. **Contracts before handlers.** New procedure → define in `@package/contracts/<ctx>` first, implement in `packages/domains/<ctx>/src/interface/` second. Frontend imports only from `@package/contracts`. ([orpc-patterns.md](../../.rulesync/rules/orpc-patterns.md))
3. **One package per bounded context.** Don't add a folder to an existing context for a term that doesn't belong to its glossary. ([bounded-contexts.md](../../docs/ddd/bounded-contexts.md))
4. **`domain/` and `application/` are framework-free.** No Hono, oRPC, Cloudflare, or React types in those folders. Inject deps via interfaces (`Clock`, `Repo`, etc.).
5. **`bun run check` must pass before declaring done.** It runs `lint && spell && typecheck && test`. CI runs the same gate; local pass is the contract.
6. **No `any`, no `@ts-ignore` without a comment, no `console.log` of secrets.**
7. **Pause before hard-to-reverse actions.** Don't push to main, force-push, delete branches, or expand scope without surfacing it first.

## Step 3 — Execute the chosen workflow

Open the linked how-to and follow it step by step. The how-to tells you exactly what to read, what to produce, and when to stop.

When done, run `bun run check`. If green, surface a one-paragraph summary of what changed. If red, fix it before declaring done.

## When the user phrasing is ambiguous

Default to ASKING. Examples:

- User: "let's work on the wiki" → ambiguous between (a) execute a slice of `0002-folder-wiki.md` and (b) start a new sub-project. Ask which.
- User: "add ingestion" → ambiguous between adding a bounded context vs implementing one already drafted in a project doc. Ask which.

A clarifying question costs one round-trip. A wrong workflow costs an entire session.
