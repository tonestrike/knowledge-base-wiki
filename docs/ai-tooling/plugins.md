# Plugins inventory

Repo-scoped Claude Code plugins, declared in [`.claude/settings.json`](../../.claude/settings.json). On first `claude` launch in this repo, you'll be prompted to install everything in `enabledPlugins`. They're cached at `~/.claude/plugins/cache/` per machine.

All plugins listed here are from Anthropic's official marketplace (`anthropics/claude-plugins-official`) — the highest trust signal. We deliberately avoid solo-author plugins for workflow-critical tools.

## Table of contents

- [Why these were chosen](#why-these-were-chosen)
- [Currently installed](#currently-installed)
- [Skills shipped with each plugin](#skills-shipped-with-each-plugin)
- [Adding a plugin](#adding-a-plugin)
- [Removing a plugin](#removing-a-plugin)

## Why these were chosen

The default for any workflow-critical agent capability is "install the Anthropic-shipped version, not a solo project". Solo-author skills churn, lose maintenance, or quietly break — all painful in a long-lived codebase. The plugins below cover planning, code review, refactoring, debugging, doc lookups, and TS intel; that's enough machinery for most day-to-day work.

For tenex-specific patterns (DDD glossary management, oRPC procedure scaffolding) we author bespoke skills under `skills/` — see [skills.md](skills.md).

## Currently installed

| Plugin | Purpose | When to use |
|---|---|---|
| **superpowers** | Obra's planning + TDD + debug suite (now Anthropic-shipped) | Default planner when starting any non-trivial change |
| **feature-dev** | Anthropic-blessed explore→design→review loop | End-to-end feature work |
| **code-review** | Multi-agent PR review with confidence scoring | Pre-merge gate; pairs with `pr-review-toolkit` |
| **pr-review-toolkit** | Specialized review agents (tests, types, errors, simplification) | Same trigger as `code-review` |
| **code-simplifier** | Refactor recently-modified code for clarity | After landing a feature, before opening the PR |
| **commit-commands** | `/commit`, `/push`, `/pr` slash commands | Git workflow shortcuts |
| **typescript-lsp** | TS LSP for code intelligence | Always on for this repo (TS-everywhere) |
| **claude-md-management** | Audit/update `CLAUDE.md`, capture session learnings | Periodic; before a release |
| **claude-code-setup** | Recommends hooks/skills/MCPs for a codebase | One-shot at repo bootstrap |
| **skill-creator** | Author/optimize/eval skills | When writing a tenex-specific skill |
| **context7** | Upstash version-pinned doc lookups | When agent needs Hono, oRPC, Bun, or library docs |
| **github** | Official GitHub MCP | Issue/PR management |
| **playwright** | Microsoft E2E browser MCP | UI tests, end-to-end specs |
| **remember** | Tiered daily memory across sessions | Always on (lightweight) |

## Skills shipped with each plugin

Each plugin contributes one or more skills to the agent's repertoire. The plugin docs at `claude.com/plugins/<name>` describe the exact skills, but here are the standouts you'll invoke most:

| Plugin | Notable skills |
|---|---|
| superpowers | `brainstorm`, `plan`, `execute-plan`, `tdd`, `debug-systematically` |
| feature-dev | `explore-codebase`, `design`, `review` |
| code-review | `review-pr`, `review-with-confidence` |
| commit-commands | `/commit`, `/push`, `/pr` |
| skill-creator | `author-skill`, `evaluate-skill` |

## Adding a plugin

1. Find the plugin at `claude.com/plugins/<name>` or in the marketplace.
2. Add to `.claude/settings.json`:
   ```json
   {
     "enabledPlugins": {
       "<plugin-name>@claude-plugins-official": true
     }
   }
   ```
3. Restart `claude` in the repo; it will prompt to install.
4. Document the plugin in this file (the table above) with **why it was added** and **when to use it**.

If the plugin lives outside Anthropic's marketplace, add a new entry to `extraKnownMarketplaces` in `.claude/settings.json`. **Be skeptical of solo-author plugins**; prefer Anthropic-shipped equivalents.

## Removing a plugin

1. Set `false` (or delete the entry) in `.claude/settings.json`.
2. Run `/plugin uninstall <name>` in `claude` to clean the cache.
3. Update this file's table — remove the row.
