# AI tooling

How tenex is set up to work with AI coding agents. We target two tools as primary: **Claude Code** (CLI + IDE extensions) and **Codex** (CLI + Desktop + IDE). Other tools (Cursor, Cline, Gemini CLI, Aider) work via fallback files and rulesync.

## Table of contents

- [Source of truth](#source-of-truth)
- [How agents discover tenex's rules](#how-agents-discover-tenexs-rules)
- [Plugins inventory](plugins.md)
- [Skills inventory](skills.md)
- [Subagents](subagents.md)
- [Working with agents](working-with-agents.md)
- [Adding a new rule, skill, or plugin](#adding-a-new-rule-skill-or-plugin)

## Source of truth

Everything starts at **`.rulesync/`** at the repo root.

```
.rulesync/
  rules/                # *.md files with YAML frontmatter — the canonical rules
    global.md           # the agent contract (read first)
    orpc-patterns.md
    domain-driven.md
    monorepo-discipline.md
    secrets.md
  .mcp.json             # MCP servers — fans out to .claude and .codex configs
```

Running `bun run rulesync` regenerates:

| File | Consumer |
|---|---|
| `AGENTS.md` (repo root) | Codex (CLI + Desktop + IDE), Cursor, others |
| `CLAUDE.md` (repo root) | Claude Code |
| `.claude/memories/*.md` | Claude Code (referenced from `CLAUDE.md`) |
| `.codex/memories/*.md` | Codex (referenced from `AGENTS.md`) |
| `.agents/memories/*.md` | shared, referenced by both |
| `.mcp.json` | Claude Code MCP loader |

These files are **committed** (so teammates without rulesync can still read them) but they should never be hand-edited — edit `.rulesync/` and regenerate.

## How agents discover tenex's rules

```
                         .rulesync/rules/
                                |
                          bun run rulesync
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
            AGENTS.md      CLAUDE.md      memories/
            (Codex)       (Claude Code)   (shared)
                              │
                              ▼
                       .claude/settings.json
                       declares marketplace plugins
                              │
                              ▼
                        skills/  ←──── symlinked from
                        (canonical)    .claude/skills/
                                       .codex/skills/
```

The Agent Skills spec is **byte-identical** between Claude Code and Codex (it's an open standard at agentskills.io), so a single `skills/<name>/SKILL.md` is auto-discovered by both tools via the symlinks.

## Adding a new rule, skill, or plugin

- **Rule (cross-cutting policy)** → add a file under `.rulesync/rules/` with frontmatter, run `bun run rulesync`.
- **Skill (reusable agent capability)** → add `skills/<name>/SKILL.md`. Both tools pick it up automatically; no config change needed.
- **Plugin (Claude marketplace bundle)** → add an entry to `.claude/settings.json` `enabledPlugins`. Run `claude` once to install. See [plugins.md](plugins.md) for the curated list.
- **Subagent** → see [subagents.md](subagents.md) — formats diverge between Claude and Codex.

## Why this exists

Without a single source of truth, AI rules drift across `.claude/`, `.codex/`, `.cursor/`, `AGENTS.md`, `CLAUDE.md`, etc. — each tool gets a slightly different (and slightly stale) version of the contract. rulesync collapses this into one editable surface, with deterministic fan-out.
