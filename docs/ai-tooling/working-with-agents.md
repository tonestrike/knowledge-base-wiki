# Working with agents

How to be a good driver of Claude / Codex when working in tenex. Most of these rules apply to any AI tool, but tenex's structure makes some of them concrete.

## Table of contents

- [Briefing rules](#briefing-rules)
- [What to delegate vs do yourself](#what-to-delegate-vs-do-yourself)
- [DDD-specific guidance](#ddd-specific-guidance)
- [Common failure modes](#common-failure-modes)
- [Parallel agents](#parallel-agents)

## Briefing rules

Treat the agent like a smart colleague who walked into the room with no context. Always include:

1. **What you're trying to accomplish.** Not just the next step.
2. **What you've already tried or ruled out.**
3. **The specific file paths and line numbers** if you've identified them.
4. **The concrete output you expect** — code change, research summary, test failure analysis.

Bad: "Fix the auth bug."
Better: "In `apps/api/src/index.ts:32`, the auth middleware reads `c.req.header('x-user-id')` but Workers' fetch API capitalizes it as `X-User-Id`. Confirm and fix; tests in `apps/api/src/auth.test.ts`."

## What to delegate vs do yourself

**Delegate** (subagent or a fresh chat):
- Independent research that won't fit in your context window
- Fan-out tasks (review N files, find every caller of X)
- Anything you'd otherwise do in a separate browser tab

**Do yourself**:
- Synthesis across delegated results — agents don't know what you're really after
- The final code review before merge — you're accountable
- Anything that touches secrets, deploys, or shared infrastructure

The principle: **never delegate understanding**. Don't write "based on your findings, fix the bug" — that pushes synthesis to the agent. Read the findings, decide, then issue a precise next instruction.

## DDD-specific guidance

When asking an agent to add or change behavior:

1. Tell it which **bounded context**. If you don't know, that's a signal to figure out the right one (or whether a new one is needed) before delegating.
2. Tell it which **layer** — `domain/`, `application/`, `infrastructure/`, `interface/`. Agents are good at staying in a layer if explicitly scoped.
3. Tell it the **glossary status** of any new term. If the term isn't in `glossary.md`, the agent should add it FIRST, then write code.

The rules in `.rulesync/rules/domain-driven.md` enforce this on the agent's side, but you should mirror it in your briefing.

## Common failure modes

| Failure | Cause | Fix |
|---|---|---|
| Agent renames things you didn't ask to rename | Briefing was too vague; agent inferred broader intent | Specify the file + line + change explicitly |
| Agent adds a new package instead of using existing one | Didn't read the workspace layout | Link the agent to `docs/architecture/README.md` upfront |
| Agent invents a glossary term not in `glossary.md` | Skipped reading the per-context dict | Quote the relevant glossary in the briefing |
| Agent writes a half-implementation and stops | Underestimated scope; ran out of token budget | Break into smaller steps; ask for one slice at a time |
| Agent commits to a destructive action (force push, delete) | Didn't ask first | The `git-guardrails-claude-code` skill helps; install it |

## Parallel agents

For tenex's research-heavy work, parallel subagents are common. Use them when:

- The questions are genuinely independent
- You want to protect your main context window from large research dumps
- You're willing to read 4 short reports instead of 1 long one

Pattern: launch 2–4 agents in parallel, each with a focused, self-contained brief. Wait for all to complete (you'll get notifications). Synthesize their reports yourself — that's the part you don't delegate.

The one trap: agents working in parallel can step on each other if their briefs overlap. Each agent needs a clearly disjoint scope. If two agents both "audit the codebase for X", they'll redo each other's work.
