# 0001 — Finish scaffolding

**Status:** Active
**Started:** 2026-05-09
**Done:** —
**Owner:** tonyvantur
**Related:** initial commit `b1dc322`

## Goal

Every gap between "scaffold runs locally" and "a teammate (or future-me) can clone this cold and ship a feature on day one" is closed, with checks enforced in CI.

## Why now

The scaffold typechecks, lints, spell-checks, and tests, but nothing about that is enforced. Day-2 me will skip steps if there's no gate. Closing the gaps before any feature work begins means the discipline holds while the codebase is still small enough to fix in one afternoon — once features land it gets exponentially harder to retrofit.

Concrete trigger: zero days of code on top of the scaffold; a CI green badge on day one means "we trust this" rather than "we hope it works."

## Out of scope

- Provisioning Cloudflare D1 / KV / R2 — defer until a feature needs them. The bindings are commented out in `wrangler.toml` and that's correct for now.
- Wiring auth — same reason. Bake in when a feature requires it.
- Web deploy target — has its own ADR pending (Slice 5 starts that conversation).
- Renovate / release-please / semver automation — premature for a private solo repo.
- Porting any patterns from `personal-website` (procedures-as-MCP-tool, react-query bindings per domain, etc.). Those are their own future projects.

## Open questions

| # | Question | Who decides | By when |
|---|---|---|---|
| Q1 | Lefthook vs. simple-git-hooks for pre-commit | tonyvantur | before Slice 4 |
| Q2 | Where does `apps/web` deploy? Cloudflare Pages, Workers static assets, or somewhere else | tonyvantur (with ADR) | Slice 5 outputs the ADR |
| Q3 | Do we want CI to also regenerate `bun run rulesync` and fail if drift exists | tonyvantur | before Slice 1 lands |

## Slices

### Slice 1 — CI workflow

**Status:** Done (commit `dcb09f5`, run `25609713122` green in 30s).
**Why:** Nothing currently enforces `bun run check`. PRs can land red.
**Done when:**
- [x] `.github/workflows/check.yml` runs on PRs and pushes to `main`
- [x] Workflow installs bun (1.3.6 pinned), restores bun + turbo caches, runs `bun install --frozen-lockfile`
- [x] Runs `bun run check` (lint + spell + typecheck + test)
- [x] Runs `bun run rulesync` and fails if `git diff --exit-code` is non-empty (catches `.rulesync/` drift) — Q3 resolved as Yes
- [x] Workflow status is green on the initial passing commit
- [ ] ~~Branch protection on `main` requires the workflow to pass before merge~~ — **Blocked by GitHub free tier**: branch protection on private repos requires GitHub Pro. CI still runs on every PR/push as a visible signal; merging red is technically possible but discouraged. Revisit if/when repo goes public or upgrades.
**Depends on:** Q3 resolved (Yes)
**Notes:** Required follow-up work during and after implementation:
1. `ab2f1a4` — wrap rulesync with `bunx --bun` because GitHub's `ubuntu-latest` ships Node 20 but rulesync uses `fs.globSync` (Node 22+). Forcing bun runtime sidesteps the Node version dependency entirely.
2. `dcb09f5` — add `Ashby`, `wordlists` to shared glossary (caught by the cspell rule running through `bun run check` on `0002-folder-wiki.md`). Real example of the discipline working as designed.
3. `6926e42` — major architectural correction: upgraded rulesync 0.69.0 → 8.15.1 (full multi-harness support — 27 native targets, skills/subagents/commands as first-class features, declarative remote-skill imports with `rulesync.lock` SHA-256 integrity). Migrated to: `.rulesync/` is the only committed source of truth; all generated outputs (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `.agents/`, `.mcp.json`) are gitignored and produced locally via the `postinstall` script running `rulesync generate`. The earlier "rulesync drift gate" CI step is therefore removed (redundant when generated content isn't in git + postinstall regenerates on every install). This is the design that scales to arbitrary new harnesses (Cursor, Cline, Windsurf, Gemini CLI, OpenCode, …) via a one-line `rulesync.jsonc` `targets` change.

### Slice 2 — ADR-0001: stack decisions

**Status:** Done (commit `d22f799`).
**Why:** The reasoning behind bun + turbo + Hono + oRPC + Cloudflare + Infisical + DDD-with-cspell lives only in the conversation that scaffolded this. Once that conversation closes, future-me has the code but not the why.
**Done when:**
- [x] `docs/decisions/0001-stack-choice.md` exists, following the template
- [x] Captures: bun (vs pnpm), biome (vs ESLint+Prettier), Hono (vs Express/Fastify), oRPC (vs tRPC), Cloudflare Workers (vs Lambda/Vercel), Infisical (vs Doppler/1Password CLI), DDD with linguistic-first discipline (vs feature folders)
- [x] Each section follows: Context → Options considered → Decision → Consequences
- [x] Links from `docs/architecture/README.md` "Why these choices" section
- [x] Index row added to `docs/decisions/README.md`
**Depends on:** —
**Estimate:** M (writing time, not thinking time — most of the thinking is already done)
**Notes:** Multi-decision ADR (one file, seven sub-decisions sharing the C/O/D/C shape) was the right call vs. seven separate ADRs — the picks are tightly coupled (Bun ↔ Biome speed; Hono ↔ Workers; oRPC ↔ contract-first DDD), and splitting them would force readers to chase cross-references. Single cspell hit during verification: `hostable` → added to `docs/glossary.txt` (cross-cutting, not domain-specific).

### Slice 3 — First-run setup script

**Why:** Day-one setup is documented but manual. Six environment vars across two tools, easy to skip a step. A script eliminates the "did I do step 4?" failure mode.
**Done when:**
- [ ] `scripts/setup` (or `bun run setup`) walks the user through:
  1. Verify bun ≥ 1.3.0
  2. `bun install`
  3. Prompt for `INFISICAL_CLIENT_ID_TENEX` + `INFISICAL_CLIENT_SECRET_TENEX`, append `export` lines to the user's chosen shell config (`~/.zshrc` default), with confirmation
  4. Run `with-secrets` end-to-end against the Machine Identity to confirm auth works
  5. Run `bun run check` — fail loudly if anything's red
- [ ] Script is idempotent (re-running is safe)
- [ ] `docs/operations/local-dev.md` "First-time setup" section becomes "run `bun run setup`"
**Depends on:** —
**Estimate:** M

### Slice 4 — Pre-commit hook

**Why:** Catches lint/format/spell drift before the push, not just at CI. Cheap insurance; biome + cspell are fast enough that the hook is unnoticeable.
**Done when:**
- [ ] Q1 resolved (lefthook vs. simple-git-hooks)
- [ ] Hook runs: `biome check --write --staged`, `cspell` on staged `.ts/.tsx/.md` files
- [ ] Hook is installed automatically by `bun install` (postinstall) so teammates don't need a separate step
- [ ] `docs/operations/local-dev.md` mentions the hook + how to bypass it (`--no-verify`) when intentional
**Depends on:** Q1
**Estimate:** S

### Slice 5 — Web deploy ADR + minimal deploy path

**Why:** `apps/web` builds to `dist/` but goes nowhere. The deploy target is a real architectural decision (where does state live? where does auth land? what's the cost?) that deserves an ADR before we wire anything.
**Done when:**
- [ ] `docs/decisions/0002-web-deploy-target.md` written, comparing: Cloudflare Pages, Workers static assets attached to `apps/api`, Vercel
- [ ] Decision recorded with consequences
- [ ] `apps/web` `deploy` script wired to the chosen target
- [ ] `docs/operations/deploy.md` "Deploy web" section updated, TBD removed
**Depends on:** —
**Estimate:** M

### Slice 6 — End-to-end smoke run

**Why:** Everything typechecks but nothing's been *executed* with real secrets. The wiring could have a runtime bug we wouldn't see at compile time.
**Done when:**
- [ ] With real `INFISICAL_CLIENT_*_TENEX` exported, `bun --filter @app/api dev` starts wrangler on :8787
- [ ] `curl http://localhost:8787/rpc/core/health` returns `{ "status": "ok", "timestamp": "..." }`
- [ ] `bun --filter @app/web dev` starts vite on :5173
- [ ] Visiting `http://localhost:5173/` shows the health response rendered
- [ ] If any of the above fail, the bug is fixed and a regression test is added (probably a `apps/api/src/router.test.ts` using Bun's test fetch helper)
**Depends on:** Slice 3 (so secrets are reliably present), Slice 1 (so a regression has CI coverage)
**Estimate:** S — assuming no runtime surprises. M if the wiring has a bug.

### Slice 7 — `.vscode/extensions.json` + workspace polish

**Status:** Done (commit `5041054`).
**Why:** Smallest leverage item, but the IDE experience is part of "scaffold a teammate can pick up cold."
**Done when:**
- [x] `.vscode/extensions.json` recommends biome, cspell, cloudflare workers types
- [x] `.vscode/settings.json` sets biome as default formatter, format on save on
- [x] `.github/PULL_REQUEST_TEMPLATE.md` with: summary, what changed, how tested, related project / ADR
- [x] `CODEOWNERS` set to `* @tonestrike`
**Depends on:** —
**Estimate:** S
**Notes:** Interpreted "cloudflare workers types" as "extensions that improve the Workers DX" — added `tamasfe.even-better-toml` (for `wrangler.toml`) and `oven.bun-vscode` (for the runtime). No first-party Cloudflare TS-types extension exists; `@cloudflare/workers-types` is picked up by the TS LSP automatically. CODEOWNERS placed at `.github/CODEOWNERS` (groups with workflows + PR template). Biome's auto-format reflowed the `cSpell.enableFiletypes` array in `settings.json` on first lint pass. Five incidental words from `docs/projects/folder-wiki/spec.md` (evals, wallclock, subrequest, Shiki, strikethrough) added to shared glossary in the same commit — same precedent as Slice 1's `dcb09f5` (Ashby, wordlists).

## Dependencies

External:
- A working Infisical Machine Identity for the `tenex` project (creating it is a one-time manual step in the Infisical dashboard; affects Slice 3 and Slice 6 directly)
- A Cloudflare account with `wrangler login` completed (Slice 5 + Slice 6 if we touch deploy paths)

Internal:
- None blocking. All slices can run in any order except: Slice 6 wants Slice 3 before it, Slice 4 wants Q1 before it, Slice 1 wants Q3 before it.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `with-secrets` wrapper has a runtime bug not caught at typecheck | Medium | Slice 6 surfaces it; cheap to fix once seen |
| Lefthook + bun postinstall hook fights with CI's `--frozen-lockfile` | Low | Test Slice 4 against Slice 1's CI before declaring done |
| ADR-0001 turns into a 5000-word essay | Medium | Hard cap each section at 200 words; link to docs for details |
| Web deploy target choice (Slice 5) blocks for weeks while we deliberate | Low | Set a 1-week soft deadline; default to Cloudflare Pages if no clear winner |

## Notes

Suggested order, given dependencies:

1. **Slice 2** (ADR-0001) — pure writing, no system risk, captures decisions while fresh
2. **Slice 1** (CI) — gate everything else; resolve Q3 first
3. **Slice 7** (IDE polish) — trivial, batches well with #2
4. **Slice 3** (setup script)
5. **Slice 4** (pre-commit hook) — resolve Q1 first
6. **Slice 6** (end-to-end smoke) — last, because it depends on #3 and #1
7. **Slice 5** (web deploy ADR) — independent; can run anytime in parallel

Total estimate: ~1 day of focused work, spread across however many sessions feels right. Each slice is a separate PR.
