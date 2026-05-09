# tenex — knowledge base

Single-source-of-truth docs for tenex. Optimized for being read end-to-end by a new engineer (or a new AI agent) on day one. If a fact lives in code, link to the code; if it lives in conversation, write it down here.

Conventions:

- Every directory has a `README.md` with its own table of contents.
- Cross-links use repo-relative paths (`../`, `./`).
- When something changes in the repo, update the relevant doc in the same PR. Stale docs are worse than no docs.

## Table of contents

### Orientation
- [Architecture overview](architecture/README.md) — layout, dependency direction, runtime topology
- [Ubiquitous language](ubiquitous-language.md) — cross-context glossary + context map
- [Glossary (cspell shared dict)](glossary.txt) — words allowed across all contexts

### Stack reference
- [oRPC + Hono patterns](stack/orpc.md) — contract-first authoring, handler delegation, error mapping
- [Cloudflare Workers](stack/cloudflare.md) — wrangler config, bindings (D1/KV/R2), local dev
- [Bun + Turborepo](stack/monorepo.md) — package layout, workspace rules, commands
- [TypeScript](stack/typescript.md) — strict-mode posture, shared tsconfigs, exotic options

### Domain-driven design
- [Bounded contexts](ddd/bounded-contexts.md) — what belongs in a context, when to add a new one
- [Layering inside a context](ddd/layering.md) — domain / application / infrastructure / interface
- [Linguistic discipline](ddd/linguistic-discipline.md) — glossary-first, cspell enforcement, banned synonyms

### Operations
- [Secrets — Infisical](operations/secrets.md) — Machine-Identity auth, `with-secrets` wrapper, multi-account
- [Deploy](operations/deploy.md) — wrangler deploy flow, secret push, rollback
- [Local dev loop](operations/local-dev.md) — getting set up day one, common commands

### AI tooling
- [Overview](ai-tooling/README.md) — the rulesync source-of-truth, how Claude + Codex see the same files
- [Plugins inventory](ai-tooling/plugins.md) — every marketplace plugin in `.claude/settings.json` and why
- [Skills inventory](ai-tooling/skills.md) — every skill in `skills/` and the recommended community ones
- [Subagents](ai-tooling/subagents.md) — Claude `.md` and Codex `.toml` agents
- [Working with agents](ai-tooling/working-with-agents.md) — how to brief them well, what to delegate vs do yourself

### Decisions
- [ADRs](decisions/README.md) — Architecture Decision Records, one per non-obvious choice

### How-to
- [Add a new bounded context](how-to/add-bounded-context.md)
- [Add a new oRPC procedure](how-to/add-procedure.md)
- [Add a new secret](how-to/add-secret.md)
- [Add a new ADR](how-to/add-adr.md)

## Reading order for new engineers

1. [Architecture overview](architecture/README.md)
2. [Ubiquitous language](ubiquitous-language.md)
3. [Bounded contexts](ddd/bounded-contexts.md) → [Layering](ddd/layering.md) → [Linguistic discipline](ddd/linguistic-discipline.md)
4. [oRPC + Hono](stack/orpc.md)
5. [Local dev loop](operations/local-dev.md) — get a server running
6. Pick one [how-to](#how-to) and execute it

For agents, the same content is reachable via `AGENTS.md` / `CLAUDE.md` at the repo root (regenerated from `.rulesync/`).
