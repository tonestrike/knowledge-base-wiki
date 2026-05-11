/**
 * Editable perspective presets shown after folder ingest.
 *
 * The user picks one preset (or "None"), the prompt textarea preloads
 * with `prompt`, and the user can edit it freely before kicking off the
 * compile. The final edited string is what gets sent as
 * `StartCompileInput.perspective` and stored on the wiki.
 *
 * Why presets are full-text and editable (not labels mapped to fixed
 * prompts): we want users to see EXACTLY what the model is told, and to
 * be able to tune it. A "Business opportunities" preset is just a
 * starting prompt — they can add domain-specific notes (e.g. "we sell
 * B2B SaaS to SMBs") right in the textarea.
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
   * ResearchSource / DraftPage / NarrateIndexes) as a "Perspective:"
   * preamble. Multi-line; markdown-friendly.
   */
  prompt: string;
}

export const PERSPECTIVE_PRESETS: ReadonlyArray<PerspectivePreset> = [
  {
    id: 'business-opportunities',
    label: 'Business opportunities',
    subtitle: 'Surface unmet needs, gaps, willingness-to-pay signals.',
    prompt: `Read this corpus as a founder looking for business opportunities.

Surface:
- Unmet needs and pain points users / customers / industries are voicing.
- Market gaps — places where existing solutions are weak, expensive, fragmented, or absent.
- Willingness-to-pay signals (budgets named, hacks people are paying to avoid, regulatory or compliance pressure).
- Competitive threats and tailwinds — who's moving, what they're missing, what trend they're riding.
- Adjacent opportunities — capabilities in this corpus that could be repurposed for a new audience or use case.

Bias toward what would help someone DECIDE to start, fund, or expand a venture. Skip background context unless it changes the conclusion.`,
  },
  {
    id: 'novel-writing',
    label: 'Novel-writing inspiration',
    subtitle: 'Extract characters, conflicts, settings, lines worth lifting.',
    prompt: `Read this corpus as a novelist mining material for fiction.

Surface:
- Characters — real or composite figures with a distinctive voice, stake, or contradiction.
- Conflicts and tensions — interpersonal, moral, structural, scientific. What's at stake and who disagrees.
- Settings — places, periods, institutions, subcultures with sensory texture.
- Plot beats — turning points, decisions, reveals, betrayals worth restructuring into a scene.
- Lines worth lifting — quotes, phrases, jargon, vocabulary that could anchor dialogue or chapter epigraphs.

Phrase pages as if briefing a writers' room. Frame each finding around the dramatic potential, not the historical record.`,
  },
  {
    id: 'engineering-decisions',
    label: 'Engineering decisions',
    subtitle: 'Decisions, tradeoffs, what would change the answer.',
    prompt: `Read this corpus as a staff engineer auditing past architectural decisions.

For each decision worth surfacing, capture:
- What was decided and when.
- Who decided (named individuals, committees, or implicit consensus).
- The constraint or forcing function — what made this a decision rather than a default.
- The tradeoff accepted (what you gave up to get what you got).
- What would change the decision today — new tech, new scale, new data, regulatory shift, postmortem evidence.

Prefer specificity over completeness. A page about ONE clear decision with the tradeoff and counterfactual beats a page summarizing five decisions vaguely.`,
  },
  {
    id: 'research-synthesis',
    label: 'Research synthesis',
    subtitle: 'Claims, methods, findings, where the corpus disagrees.',
    prompt: `Read this corpus as a researcher synthesizing what's known and contested.

Surface:
- Claims — specific assertions made about phenomena, mechanisms, or outcomes.
- Methods — how each claim was produced (the experiment, the dataset, the proof technique).
- Findings — the empirical or theoretical result, with its scope and caveats.
- Disagreements — where two sources land on different sides, and what the load-bearing assumption is between them.
- Open questions — what the corpus explicitly flags as unresolved, and what implicitly is.

Treat the corpus as a literature review. A page should be useful for a citation, not a summary.`,
  },
  {
    id: 'generic',
    label: 'Generic (no perspective)',
    subtitle: "Let the wiki organize itself around the corpus's natural shape.",
    prompt: '',
  },
];

export const DEFAULT_PERSPECTIVE_ID = 'business-opportunities';
