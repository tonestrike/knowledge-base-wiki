# Linguistic discipline

The single most important rule in tenex: **every term in code has to be in the relevant glossary**. Folder structure exists to reinforce this; the language is the leverage point.

## Table of contents

- [Why language discipline](#why-language-discipline)
- [How it's enforced](#how-its-enforced)
- [Adding a term](#adding-a-term)
- [Banned synonyms](#banned-synonyms)
- [Cross-context terms](#cross-context-terms)
- [When the glossary is wrong](#when-the-glossary-is-wrong)

## Why language discipline

Code is written more often than it's read by humans, but it's read way more often than it's written by AI agents and future-you trying to reason about a system. When the words drift, every reading costs more — you re-derive what each word means in context. Pin the words and the cost stops compounding.

Specifically: glossary discipline gives us:

- **A spec.** The glossary tells you what's in scope for a context BEFORE you read code.
- **Resistance to drift.** New names don't sneak in via auto-import; they require a glossary edit.
- **AI agents that don't invent things.** When agents see "every term must be in the glossary", they look it up first instead of fabricating.

## How it's enforced

cspell, with `addWords: false` in the dictionary definitions:

```json
{
  "dictionaryDefinitions": [
    { "name": "forum-glossary", "path": "./packages/domains/forum/.cspell/glossary.txt", "addWords": false }
  ],
  "overrides": [
    { "filename": "packages/domains/forum/**", "dictionaries": ["tenex-shared", "forum-glossary"] }
  ]
}
```

`bun run spell` runs cspell across the workspace. If you use a term that's not in the glossary, the run fails. The fix is always: add it to `glossary.md` (with definition + banned synonyms) AND `.cspell/glossary.txt`.

`addWords: false` is the critical bit. With `addWords: true`, editors silently extend the dictionary on save; with `false`, you must edit the file deliberately, and reviewers see it in the diff.

## Adding a term

The sequence is rigid:

1. **Find the smallest existing context** where the term plausibly belongs.
2. If it doesn't fit any existing context, that's a signal — see [bounded-contexts.md](bounded-contexts.md) for when to add a new one.
3. **Edit the context's `glossary.md`**: add a row with definition. If a banned synonym applies, add it.
4. **Edit `.cspell/glossary.txt`**: add the bare word.
5. Then write the code.

If you're using AI agents, the rules in `.rulesync/rules/domain-driven.md` instruct them to follow this sequence — but they sometimes don't. Catch it in review.

## Banned synonyms

For any term, list the words you DON'T want anyone to use for it. cspell `flagWords` makes this enforceable:

```markdown
| Don't write | Write |
|---|---|
| user (in forum context) | Member |
| reply | Comment |
| upvote, downvote | Vote (with sign) |
```

Adding banned synonyms is more valuable than adding more terms. A good glossary is small and opinionated.

## Cross-context terms

When the same word means different things in two contexts (e.g. `User` in identity vs `Member` in forum), DON'T unify them. Add a "see also" cross-reference row in [`../ubiquitous-language.md`](../ubiquitous-language.md):

| Word | Context A | Context B |
|---|---|---|
| User / Member | identity: an authenticated principal | forum: a participant identified by ID, no auth context |

Translation between the two happens at the interface layer of whichever context is consuming the other.

## When the glossary is wrong

Sometimes you discover a term is wrong — too narrow, too broad, conflated with something else. Process:

1. Open a small PR titled `glossary: rename X to Y in <context>`.
2. Update the glossary entry first (definition + banned synonym row pointing the other way).
3. Then rename in code (one PR per rename keeps the diff readable).
4. If the rename affects another context, update the cross-context map in `../ubiquitous-language.md`.

Don't bundle glossary changes with feature work. The point of the glossary is to be a separate object you can review on its own.
