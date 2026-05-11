/**
 * Editable perspective presets shown after folder ingest.
 *
 * The user picks one preset (or "Custom"), the prompt textarea preloads
 * with `prompt`, and the user can edit it freely before kicking off the
 * compile. The final edited string is what gets sent as
 * `StartCompileInput.perspective` and stored on the wiki.
 *
 * The presets are deliberately opinionated and concrete — each one names
 * the priority bullets, the naming conventions to prefer, and the
 * anti-patterns to avoid. The compile pipeline's per-stage enforcement
 * (see `withPerspective` in `packages/domains/wiki/src/application/`)
 * leans on this structure to drive PageType names, page titles, and
 * page bodies in the right direction.
 *
 * Why presets are full-text and editable (not labels mapped to fixed
 * prompts): we want the user to see EXACTLY what the model is told.
 * They can also add domain-specific notes (e.g. "we sell B2B SaaS to
 * SMBs") inline.
 */
export interface PerspectivePreset {
  /** Stable id used as a React key. */
  id: string;
  /** Short, button-sized label. */
  label: string;
  /** One-sentence subtitle shown under the label on the chip. */
  subtitle: string;
  /**
   * The editable prompt body. This is what threads into the compile
   * pipeline's system prompts (SchemaInferrer / PlanCompile /
   * ResearchSource / DraftPage / NarrateIndexes) as a "PERSPECTIVE:"
   * preamble. Multi-line; markdown-friendly.
   */
  prompt: string;
}

export const PERSPECTIVE_PRESETS: ReadonlyArray<PerspectivePreset> = [
  {
    id: 'business-opportunities',
    label: 'Business opportunities',
    subtitle: 'Surface unmet needs, gaps, willingness-to-pay signals.',
    prompt: `Read this corpus as a founder hunting for a business to start, fund, or expand. Every page in the wiki you build must be DIRECTLY USEFUL for that decision — every title, section, and finding should answer "would this change what I do?".

What to surface (priority order):
1. Unmet needs / pain points — quotes, complaints, workarounds, hacks people are paying to avoid. Always name the user, customer, or industry voicing it.
2. Market gaps — where existing solutions are weak, expensive, fragmented, or absent. Be specific about who loses and roughly how much.
3. Willingness-to-pay signals — budgets named, hours spent, regulatory or compliance pressure, contracts up for renewal, dollars left on the table.
4. Competitive landscape — who's moving, what they're missing, what tailwind they're riding. Who would buy you. Who would kill you.
5. Capability arbitrage — assets, expertise, datasets, or workflows in this corpus that could be repurposed for a new audience or use case.
6. Timing wedges — what changed recently (regulation, tech cost, distribution channel) that makes NOW different from 18 months ago.

Naming conventions (use these — they shape every page):
- PageType names: prefer Opportunity, Pain, Customer, Channel, Competitor, Trend, Wedge, Risk. Reject generic "Topic" / "Concept" / "Person" unless the perspective demands it.
- Page titles: name the finding, not the topic. "AP teams pay $40K/yr for invoice OCR" beats "Invoice processing software".
- One sharp opportunity per page, sized and risked. A survey page is a failed page.

Anti-patterns (avoid hard):
- Background pages that "set context" without producing a takeaway.
- Findings that don't change a go/no-go decision.
- Sanitized numbers. If the source says "$2.3M ARR", the page says "$2.3M ARR".`,
  },
  {
    id: 'novel-writing',
    label: 'Novel-writing inspiration',
    subtitle: 'Extract characters, conflicts, settings, lines worth lifting.',
    prompt: `Read this corpus as a novelist mining material for fiction. Your job is to extract DRAMA, not summarize fact. Every page should give a writer something they can SCENE.

What to surface (priority order):
1. Characters — figures with a distinctive voice, contradiction, stake, or arc. Real or composite. Capture VOICE (sentence patterns, vocabulary, what they refuse to say), not just bio.
2. Conflicts — interpersonal, moral, structural, scientific. Who disagrees with whom, what's at stake if one side wins, what each side thinks the other is missing.
3. Settings — places, periods, institutions, subcultures with sensory texture. Smells, sounds, social rules, tribal markers.
4. Plot beats — turning points, decisions, reveals, betrayals, coincidences. Each one a scene-able moment with a before and an after.
5. Lines worth lifting — quotes, phrases, jargon, vocabulary that could anchor dialogue, chapter epigraphs, or a character's tic. Verbatim, with attribution.
6. Symbols & motifs — objects, places, gestures that recur and accumulate meaning.

Naming conventions:
- PageType names: prefer Character, Conflict, Scene, Setting, Voice, Motif, Beat, Reveal. Reject academic "Topic" / "Person" framings.
- Page titles: dramatic, not topical. "The Engineer Who Approved His Own Code Review" beats "Software engineering oversight".
- One charged moment per page beats a chronology.

Anti-patterns:
- Encyclopedic "Background on X" pages. Skip context unless it raises the stakes.
- Paraphrasing quotes. Lift them verbatim or don't include them.
- Smoothing over inconvenient details. The contradiction IS the material.`,
  },
  {
    id: 'engineering-decisions',
    label: 'Engineering decisions',
    subtitle: 'Decisions, tradeoffs, what would change the answer.',
    prompt: `Read this corpus as a staff engineer auditing past architectural decisions — to learn from them AND to know which to revisit. Every page is one decision, recorded ADR-style.

What to capture per decision (priority order):
1. Decision — what was decided, in one sentence. Past tense.
2. Forcing function — the constraint that made this a decision rather than a default. Performance? Compliance? Vendor sunset? Team scale? Cost?
3. Alternatives weighed — the other options considered and briefly why each was rejected.
4. Tradeoff accepted — what you gave up to get what you got. Be honest.
5. Decider(s) — named individuals, committees, or implicit consensus ("the IC team", "ratified after the Q3 outage"). Hiding the decider hides accountability.
6. Trigger to revisit — what would change the answer? New scale? New tech? New regulatory regime? New postmortem? Be specific so a future reader knows when to come back.
7. Evidence trail — what data, prototype, benchmark, or argument was load-bearing.

Naming conventions:
- PageType names: prefer Decision, Constraint, Tradeoff, Postmortem, ADR, Pattern, Antipattern. Reject "Topic" / "Concept".
- Page titles: name the decision. "Chose Postgres LISTEN/NOTIFY over Kafka for v1 audit log" beats "Audit log architecture".
- One decision + its counterfactual per page beats a survey.

Anti-patterns:
- Papering over the tradeoff. If the team knowingly picked the worse option, say so and say why.
- Omitting the decider. "The team decided" is not a sentence.
- Writing history without a revisit trigger. The future reader has no way to know when to re-open the question.`,
  },
  {
    id: 'research-synthesis',
    label: 'Research synthesis',
    subtitle: 'Claims, methods, findings, where the corpus disagrees.',
    prompt: `Read this corpus as a researcher synthesizing a literature. Every page is one claim or one method, with its evidence and its scope.

What to extract per item (priority order):
1. Claim — the specific assertion made about a phenomenon, mechanism, or outcome. Atomic — one claim per page when possible.
2. Method — how the claim was produced (experiment, dataset, proof technique, survey instrument). Enough to assess validity.
3. Findings — the empirical or theoretical result with units, scope, and uncertainty. Numbers, intervals, conditions.
4. Caveats / scope conditions — where the claim does NOT apply, what the authors flag as limits, what a critical reviewer would ask.
5. Disagreements — where two sources land on different sides. Name the load-bearing assumption separating them.
6. Open questions — what the corpus explicitly flags as unresolved, what it implicitly leaves open. The "future work" section, written better.

Naming conventions:
- PageType names: prefer Claim, Finding, Method, Phenomenon, Limitation, Disagreement, OpenQuestion. Reject "Topic" / "Concept".
- Page titles: the claim, not the area. "Mixed helpful+harmless training reduces refusal rate without raising harmful compliance" beats "RLHF training methods".
- A page useful for a citation beats a summary page.

Anti-patterns:
- Synthesizing across studies in a single sentence. Each claim has its own provenance — keep them separable.
- Omitting effect sizes / sample sizes / confidence intervals when the source gives them.
- Hiding the disagreements. They're the most cite-worthy material in the corpus.`,
  },
  {
    id: 'custom',
    label: 'Custom',
    subtitle: 'Write your own lens — empty canvas, total control.',
    prompt: '',
  },
];

export const DEFAULT_PERSPECTIVE_ID = 'business-opportunities';
