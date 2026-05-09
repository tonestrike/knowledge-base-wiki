# verification — ubiquitous language (draft)

Bounded context for independently auditing Wiki Claims against original
Spans. Catches hallucinations baked in during Compile. Produces `LintFinding`s
that may be applied to the wiki as Corrections via domain event.

## Aggregate

`LintRun` is the aggregate root, scoped to one Wiki (or a subset of
WikiPages).

## Terms

| Term | Definition | Notes |
|---|---|---|
| LintRun | A single audit pass over a Wiki or subset. Has a status, started-at, ended-at, and a set of LintFindings. | Aggregate root. |
| LintFinding | The per-Claim outcome of a LintRun: a Verdict + supporting evidence + (optional) suggested Correction. | |
| Claim | A verifiable assertion extracted from a WikiPage. References the WikiPage, source Citations, and the Claim text. | Same identity as `Claim` in wiki. |
| Verdict | One of: `supported`, `unsupported`, `contradicted`. The Verifier's call. | Closed enum. |
| Verifier | The agent that issues Verdicts: extracts Claim text, fetches cited Spans, decides whether they support the Claim. | Should use a different model from the Compiler (avoid self-grading bias). |
| Correction | A proposed edit to a WikiPage that fixes an unsupported or contradicted Claim. Includes replacement text and (optionally) a fresh Citation. | |
| Audit | The act of verifying one Claim — a sub-step inside a LintRun. | |

## Banned synonyms

| Don't write | Write |
|---|---|
| fact-check | audit (the act) or LintRun (the aggregate) |
| review | LintRun (review is reserved for code review) |
| validation | verification (and the result is a Verdict) |
| hallucination | unsupported Claim — keep "hallucination" for marketing, never code |
| check | audit |
| true / false | supported / unsupported / contradicted |

## Cross-context notes

- `Claim`, `Citation`, `Span`, `WikiPage` all read-only here, sourced from wiki and ingestion via contracts. Verification never mutates them directly.
- A `Correction` is *proposed* here and *applied* by wiki via a `CorrectionAccepted` domain event.

## cspell words

```
verification
verifier
verdict
audit
lintrun
lintfinding
claim
correction
supported
unsupported
contradicted
```
