# Skills inventory

Skills are reusable agent capabilities defined as a directory with a `SKILL.md` (Agent Skills spec). They live in [`skills/`](../../skills/) at the repo root. `.claude/skills/` and `.codex/skills/` are symlinks to `skills/`, so both Claude Code and Codex auto-discover the same files.

## Table of contents

- [What goes in `skills/`](#what-goes-in-skills)
- [tenex-specific skills](#tenex-specific-skills) (currently empty — populate as we add them)
- [Recommended community skills](#recommended-community-skills)
- [Authoring a new skill](#authoring-a-new-skill)

## What goes in `skills/`

| Goes here | Goes elsewhere |
|---|---|
| Skills specific to tenex's patterns (DDD glossary management, oRPC procedure scaffolding, our specific deploy flow) | Generic workflow skills — those come from Anthropic-marketplace [plugins](plugins.md) |
| Skills we want to keep stable across agent versions | Fast-moving experiments — try them locally first |

The line: if a skill encodes our domain-specific workflow, it's here. If it's a generic capability that has a well-maintained marketplace plugin equivalent, install the plugin instead.

## tenex-specific skills

| Skill | What it does | When an agent should invoke it |
|---|---|---|
| [`monorepo`](../../skills/monorepo/SKILL.md) | Entry-point router for any task in this repo. Identifies intent (new project / slice execution / bounded context / procedure / ADR / secret / review / debug) and points at the right how-to. Reminds the agent of always-on rules. | Always, when starting any task in this repo. The skill description triggers on any in-repo prompt — agents shouldn't have to be told to invoke it. |

Planned candidates (promote from how-to to skill if they get used heavily):

- `add-procedure` — currently lives as a how-to at [`docs/how-to/add-procedure.md`](../how-to/add-procedure.md)
- `add-bounded-context` — at [`docs/how-to/add-bounded-context.md`](../how-to/add-bounded-context.md)
- `glossary-audit` — reads a domain's glossary and reports terms in code that are missing (no how-to yet)
- `deploy-checklist` — pre-deploy gate (typecheck + tests + secrets diff + wrangler dry-run)

## Recommended community skills

The most reputable non-Anthropic skill collection is **`mattpocock/skills`** (67.8k★, daily commits). To install:

```sh
npx skills@latest add mattpocock/skills
```

This drops the pack into a temp dir; cherry-pick into `skills/` at the repo root. Recommended subset for a TypeScript-heavy DDD repo:

| Skill | What it does | Why we want it |
|---|---|---|
| `grill-me` | Stress-tests a plan by exhaustive questioning | Forces sharper requirements before code |
| `grill-with-docs` | Like `grill-me` but updates ADRs/CONTEXT live | Keeps documentation in sync with reasoning |
| `tdd` | Red-green-refactor loop | Pairs with `superpowers` for disciplined dev |
| `diagnose` | Reproduce → minimize → hypothesize → fix | Better debugging discipline than ad-hoc |
| `to-prd` | Conversation → product requirements doc | Useful at feature kickoff |
| `to-issues` | Conversation → vertical-slice GitHub issues | Breaks PRDs into shippable units |
| `improve-codebase-architecture` | Reads CONTEXT.md + ADRs, suggests refactors | Surfaces drift over time |
| `git-guardrails-claude-code` | Blocks dangerous git ops | Cheap insurance |

Skip the rest of Pocock's pack: `caveman` (compression mode), `zoom-out`, `prototype`, `triage` are situational; deprecated ones (`design-an-interface`, `qa`, `request-refactor-plan`, `ubiquitous-language`) shouldn't be installed.

## Authoring a new skill

1. Create `skills/<name>/SKILL.md` with frontmatter:
   ```markdown
   ---
   name: <name>
   description: <one-line trigger description — used by agents to decide when to invoke>
   ---

   # <Title>

   <body — instructions, examples, scripts, references>
   ```
2. Optionally add scripts, examples, or supporting files in the same directory.
3. Both Claude Code and Codex pick it up automatically (no rebuild step).
4. Add a row to the [tenex-specific skills](#tenex-specific-skills) table above with **what it does** and **when an agent should invoke it**.

The trigger description is the most important field — it's what the agent reads when deciding whether to use the skill. Be specific about the situation, not the steps.
