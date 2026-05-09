# skills/

Canonical Agent Skills directory. Symlinked into `.claude/skills/` and `.codex/skills/` so both Claude Code and Codex see the same SKILL.md files (the spec is byte-identical between the two).

## Layout

```
skills/
  <skill-name>/
    SKILL.md              # required, Agent Skills spec
    [scripts, references, examples]
```

## Adding a skill

1. Author `skills/<name>/SKILL.md` with the standard frontmatter (`name`, `description`, optional `model`).
2. The skill is immediately discoverable by both tools — no rebuild step.

## Recommended community skills

Run `npx skills@latest add mattpocock/skills` to fetch Matt Pocock's pack into a temp dir, then copy the ones you want into `skills/`:

- `grill-me` — stress-tests plans by exhaustive questioning
- `grill-with-docs` — like grill-me but updates CONTEXT/ADRs live
- `tdd` — red-green-refactor loop
- `diagnose` — reproduce → minimize → hypothesize → fix
- `to-prd`, `to-issues` — convo → PRD → vertical-slice GH issues
- `improve-codebase-architecture` — uses CONTEXT.md + ADRs to suggest refactors
- `git-guardrails-claude-code` — blocks dangerous git ops

For workflow-oriented things (planning, code review, debug), prefer the Anthropic marketplace plugins declared in `.claude/settings.json`. Use `skills/` for tenex-specific skills (e.g. domain authoring patterns, oRPC procedure scaffolding).
