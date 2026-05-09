# core — ubiquitous language

This is the canonical glossary for the **core** bounded context. Every term used in code under `packages/domains/core/` MUST appear here. cspell enforces this via `.cspell/glossary.txt` with `addWords: false` — adding a new term requires editing both files in the same PR.

## Terms

| Term | Definition | Notes |
|---|---|---|
| Health | A liveness signal indicating the API is reachable. | Used by health-check procedures. Distinct from "status" which implies richer state. |
| Ping | A request that echoes a message back. | Diagnostic only. Not for general messaging. |

## Banned synonyms (use these instead)

| Don't write | Write |
|---|---|
| heartbeat | health |
| echo (as a verb on its own) | ping |
| status | health (in this context — other contexts may legitimately use "status") |

When this context grows: add new aggregates, value objects, and domain events here BEFORE writing code that names them. The glossary is the spec.
