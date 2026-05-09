# How to add an ADR

ADRs (Architecture Decision Records) capture non-obvious decisions. See [`../decisions/README.md`](../decisions/README.md) for context on when to write one.

## Steps

1. Get the next number from [`../decisions/README.md`](../decisions/README.md)'s index — start at `0001`, zero-padded to four digits.
2. Create `docs/decisions/NNNN-short-title.md` using the template in the [decisions README](../decisions/README.md#template).
3. Add a row to the [decisions index](../decisions/README.md#index).
4. Open a PR. Land the ADR in the same PR as the code change it describes (or just after, if the change is already merged).

## What the title should look like

- Imperative, lowercase-with-hyphens: `0003-use-drizzle-for-d1-access.md`
- Read it as "decision: <title>" and check it's complete: "decision: use drizzle for d1 access" ✓

## What the ADR body should NOT do

- Don't restate background that's already in [`../architecture/README.md`](../architecture/README.md). Link.
- Don't be aspirational — ADRs document what was decided, not what we'd like to decide.
- Don't write a novel. The Context + Options + Decision + Consequences template fits in 300–600 words for most decisions.

## When to supersede vs amend

If the original decision is wrong or no longer applies:

- **Supersede.** Write a new ADR (next number) explaining why the old one no longer holds. Mark the old one as "Superseded by NNNN" in its status line.
- **Don't** edit the old ADR's decision. Edit the status line and link forward; preserve the original reasoning so future readers see how thinking evolved.
