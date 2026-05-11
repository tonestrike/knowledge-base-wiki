# tenex

TypeScript monorepo. Bun + Turborepo + Hono on Cloudflare Workers + Vite/React on the frontend. Domain-driven, contract-first.

The product is a **folder-grounded wiki**: point it at a Google Drive folder, the API ingests every PDF / Doc / Sheet / Slide, the compiler turns the collection into a wiki of typed pages with byte-range citations, a verification pass lints every claim against its cited span, and a chat surface answers questions over the wiki with the same span-verifying loop.

## Live demo

The app is already deployed to Cloudflare Workers — no setup required to try it:

**<https://tenex-api.tonyvantur.workers.dev>**

The Worker serves both the SPA (`/*`) and the oRPC api (`/rpc/*`) from the same origin — no CORS, no separate frontend deploy. Health check: <https://tenex-api.tonyvantur.workers.dev/rpc/core/health>.

## Quick start

You need **bun ≥ 1.3.0** and **Node.js ≥ 22** (wrangler's local dev needs real Node — under bun's node-shim, wrangler's ProxyWorker IPC hangs).

```sh
git clone <repo>
cd tenex

bun install                                       # installs deps, runs rulesync, wires git hooks
cp apps/api/.dev.vars.example apps/api/.dev.vars  # then fill in values — see file comments
bun run dev                                       # starts api on :8787 and web on :5173
```

Open <http://localhost:5173>.

### What goes in `.dev.vars`

`apps/api/.dev.vars` is the **only** secrets file. Wrangler reads it automatically for local dev; `bun --filter @app/api run secrets:put` uploads the same values as Cloudflare Workers secrets for production. The example file documents each var inline; the four required ones are:

| Var | What it is | How to get it |
|---|---|---|
| `OAUTH_TOKEN_KEY_BASE64` | AES-GCM key encrypting Drive refresh tokens at rest in D1. | `openssl rand -base64 32` |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth web client for Drive ingestion. | Google Cloud Console → APIs & Services → Credentials → New OAuth client ID (Web application). |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same client's secret. | Same screen. |
| `OPEN_ROUTER_API_KEY` | Routes the wiki compiler + chat + verifier to Anthropic models. | <https://openrouter.ai/keys> |

Add `http://localhost:8787/rpc/ingestion/authCallback` to your Google OAuth client's authorized redirect URIs.

## Layout

```
apps/
  api/                            # @app/api — Hono on Cloudflare Workers, mounts the oRPC router
  web/                            # @app/web — Vite + React + React Query, consumes contracts
packages/
  contracts/                      # @package/contracts — oRPC contract definitions (the seam)
  shared-kernel/                  # @package/shared-kernel — ids, Result, Clock — small primitives
  domains/
    <bounded-context>/            # one package per bounded context
      src/domain/                 # entities, value objects, events (framework-free)
      src/application/            # use-cases, command/query handlers (framework-free)
      src/infrastructure/         # adapters, repository implementations
      src/interface/              # oRPC procedure handlers (implement contracts)
      glossary.md                 # ubiquitous language for THIS context
      .cspell/glossary.txt        # cspell dictionary for THIS context
  tooling/
    biome/                        # @tooling/biome — shared biome config
    tsconfig/                     # @tooling/tsconfig — shared TS configs
docs/                             # architecture, ops runbooks, ADRs, how-tos
```

There are five bounded contexts under `packages/domains/`: `core`, `ingestion`, `wiki`, `chat`, `verification`.

## Commands

| Goal | Command |
|---|---|
| Install deps | `bun install` |
| Start everything (web + api) | `bun run dev` |
| Start only api | `bun --filter @app/api dev` |
| Start only web | `bun --filter @app/web dev` |
| Run all checks (lint + spell + typecheck + test) | `bun run check` |
| Auto-fix lint + format | `bun run fix` |
| Type-check only | `bun run typecheck` |
| Tests only | `bun run test` |
| Deploy to Cloudflare | `bun run deploy` |
| Push prod Worker secrets from `.dev.vars` | `bun --filter @app/api run secrets:put` |
| Regenerate AI rule files | `bun run rulesync` |
| Clean caches | `bun run clean` |

## Conventions

- **One package per bounded context.** Turborepo's package boundary IS the DDD context boundary; cross-context imports go through `@package/contracts` (sync) or domain events through `@package/shared-kernel` (async). `domains/X` cannot import from `domains/Y`.
- **Contract-first.** Procedures are defined in `packages/contracts`, implemented in each domain's `interface/`. Frontend imports only from `@package/contracts`.
- **`domain/` and `application/` are framework-free.** No Hono, oRPC, Cloudflare types, or React. Dependencies pass through interfaces (`Clock`, `Repo`, etc.).
- **Linguistic DDD.** Each context has its own `glossary.md` and cspell dictionary with `addWords: false` — adding a new term requires a glossary edit in the same PR.

## Deploy

Once you've authored `.dev.vars` and run `bun run check`:

```sh
bun run deploy
```

The `scripts/deploy` orchestrator auto-provisions D1 / KV / R2 if their IDs in `wrangler.toml` are still placeholders, applies every D1 migration to the remote prod database, uploads `.dev.vars` to Worker secrets, builds the SPA, and ships the Worker (which serves both `/rpc/*` and the static SPA bundle). Full walkthrough: [`docs/operations/deploy.md`](docs/operations/deploy.md).

Cloudflare login is one-time and runs interactively: `bunx wrangler login` if you haven't already.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `apps/api/.dev.vars not found` on `bun run dev` | Step skipped after install | `cp apps/api/.dev.vars.example apps/api/.dev.vars` and fill in values |
| Wrangler dev prints "Ready on …" but HTTP requests hang | Bun's node-shim took over `node` for the wrangler subprocess | Make sure `node --version` is `v22.x`. If you use nvm, run `nvm use 22` in this shell. `apps/api/scripts/dev` strips the bun-shim from PATH but only fires if you go through `bun run dev`. |
| `OAUTH_TOKEN_KEY_BASE64 is required` at runtime | Missing or empty in `.dev.vars` | Set with `openssl rand -base64 32`. |
| `cspell: Unknown word (X)` | Term not in a context glossary | Add the bare word to the relevant `packages/domains/<ctx>/.cspell/glossary.txt` AND its `glossary.md` (no `addWords` shortcut). |
| Port 8787 or 5173 in use | A previous dev server didn't shut down | `lsof -i :8787` then `kill <pid>`. |

## Design tradeoffs (what we did and didn't build)

We made two deliberate scope choices that are worth calling out so reviewers don't read the gaps as oversight.

### We indexed by typed *perspectives*, not by embeddings

The interesting bet in this take-home is the *wiki*: an LLM-compiled, span-cited, lint-verified knowledge structure over a folder. The retrieval mechanic that powers chat is a secondary concern — once the wiki exists, search-quality improvements stack on top of it cleanly.

So the chat agent's research loop today is a tool-using loop over the wiki itself: page-type search, browse-by-section, and source-text fallback, all running against D1 + R2 with byte-range citations the synth verifier can re-hash. No vector store. No embedding model. Token-overlap scoring and the typed page schema do the work.

**Given more time, we would have added an embeddings + vector-store layer** (Cloudflare Vectorize or pgvector-on-D1) underneath the existing `WikiReader` port. Two things land for free:
- **Better recall on chat search.** "Deceptive AI behavior" matches a page titled "Alignment faking" even when the keywords don't overlap.
- **Better source-discovery fallback.** The `searchSources` path in `packages/domains/chat/src/infrastructure/d1-wiki-reader.ts` is the natural seam — swap token-overlap for a `top-k` similarity query against pre-computed chunk embeddings.

The architecture is set up for this: `WikiReader` is an interface, the composition root in `apps/api/src/build-chat-context.ts` picks the implementation, and the citation/lint contract (`SourceHashVerifier`) is agnostic to how candidate pages are surfaced. Adding the vector path is additive — it doesn't change the wiki schema, the synthesizer, or the verifier.

### We indexed PDFs (mostly), not every document type

The ingestion pipeline supports PDFs, Google Docs, Google Sheets, and Google Slides today (`packages/domains/ingestion/src/infrastructure/`), with PDF being the primary path. Word, image-with-OCR, raw text, transcripts, etc. are **all out of scope** for this submission — not because they're hard, but because file-format handling is an orthogonal problem that doesn't affect the wiki's core thesis.

The architecture deliberately makes ingestion an extension point:
- Each format is its own `Extractor` adapter in `packages/domains/ingestion/src/infrastructure/` (see `pdf-extractor.ts`, `google-doc-extractor.ts`, etc.).
- A new format = a new file in that directory + one line in the `buildIngestionContext` factory in `apps/api/src/index.ts`. The wiki compile, the chat agent, the verifier, and the SPA see nothing new.
- The `Manifest` value object in the ingestion domain carries `mime` + raw bytes — every downstream stage works in terms of the extracted text, not the source format.

**Given more time we would have added:** Word (`docx`), images via VLM captioning (Sonnet 4.6 vision → text), audio transcripts (Whisper), plain Markdown, structured CSV/JSON. Each is a self-contained Extractor; none requires changes outside `packages/domains/ingestion/`.

The choice was: prove the wiki concept end-to-end on one well-understood format, rather than spread engineering thin across many formats with a thinner wiki on top.

## AI tooling

This repo is set up to work with both **Claude Code** and **Codex**. Source of truth lives in `.rulesync/`; `bun install` runs `rulesync generate` via postinstall, fanning the rules out to `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, and `.agents/` (all gitignored). Skills live in `skills/<name>/SKILL.md` and are symlinked into both `.claude/skills/` and `.codex/skills/`.

## Docs

The full knowledge base lives at [`docs/`](docs/README.md) — architecture overview, DDD rules, stack reference, ops runbooks, ADRs, how-to guides. Start there if you want to go deeper.
