# Subagents

Subagents are scoped sub-conversations that run with their own tool set and context. Used for: parallelizable research, isolated implementation work, code review of finished branches.

## Table of contents

- [Why subagents diverge between Claude and Codex](#why-subagents-diverge-between-claude-and-codex)
- [Claude subagents (`.claude/agents/`)](#claude-subagents-claudeagents)
- [Codex subagents (`.codex/agents/`)](#codex-subagents-codexagents)
- [When to add a subagent](#when-to-add-a-subagent)

## Why subagents diverge between Claude and Codex

Skills are byte-identical (open Agent Skills spec). **Subagents are not.**

| | Claude | Codex |
|---|---|---|
| Location | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` |
| Format | Markdown with YAML frontmatter | TOML with `developer_instructions`, tool list, model selection |
| Required fields | `name`, `description`, `tools` | `name`, `description`, `developer_instructions`, plus Codex-specific config |

Maintain them separately. rulesync does not unify subagents (yet).

## Claude subagents (`.claude/agents/`)

_(none yet — populate as needed)_

When we add one, the file looks like:

```markdown
---
name: code-reviewer
description: Reviews changed code for type safety, tests, and architectural drift before merge.
tools: Read, Grep, Bash
model: sonnet
---

You are a code reviewer for the tenex repo. ...
```

## Codex subagents (`.codex/agents/`)

_(none yet — populate as needed)_

When we add one, the file looks like:

```toml
name = "code-reviewer"
description = "Reviews changed code before merge"
model = "gpt-5"

developer_instructions = """
You are a code reviewer for the tenex repo. ...
"""
```

## When to add a subagent

Don't preemptively port the personal-website's 11 subagents wholesale. Add a subagent only when:

1. We have a recurring delegation pattern (research, review, test running) that we hit at least 3 times.
2. The task has a clear scope and a clear "done" condition.
3. The result is small enough to summarize in one message back to the parent.

Otherwise, just describe what you want inline — agents are good at one-off briefings without needing a named subagent.
