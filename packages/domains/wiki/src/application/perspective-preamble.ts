/**
 * Compile-stage tags for `withPerspective`. Each tag selects a clause
 * tailored to that prompt's output shape (PageType names, finding
 * extraction, prose drafting, etc). The clauses are deliberately
 * directive — earlier "bias toward" wording failed: a music/biking
 * corpus compiled under "find business opportunities" still produced
 * Tool/Skill/Resource PageTypes because the model treated the
 * perspective as a soft hint and snapped to the corpus's natural shape.
 */
export type PerspectiveStage = 'schema' | 'plan' | 'research' | 'draft' | 'narrate';

const STAGE_DIRECTIVES: Record<PerspectiveStage, string> = {
  schema: `STAGE: SchemaInferrer
You are about to name the PageTypes for this wiki. These names cascade through
every downstream step — they become the section headings, the page-type chips,
the URLs, the chat agent's vocabulary. Choose them THROUGH THE PERSPECTIVE.

Specifically:
- If the PERSPECTIVE block above names preferred PageType vocabulary (e.g.
  "Opportunity, Pain, Customer, Channel"), USE THOSE NAMES verbatim. Do not
  invent synonyms or fall back to generic alternatives because the corpus's
  literal content seems to fit a different shape better. THE USER PICKED THE
  PERSPECTIVE PRECISELY TO RESHAPE THE CORPUS — honor that choice.
- If the perspective implies vocabulary without naming it, derive PageType
  names a perspective-holder would actively use. A business-opportunities
  perspective on a corpus of music tutorials should yield PageTypes like
  Opportunity / Pain / Wedge — NOT Tool / Topic / Resource — even though the
  corpus is "about" music.
- REJECT generic catch-all names ("Topic", "Concept", "Resource", "Tool",
  "Person") unless the perspective explicitly endorses them.
- The schema's \`reason\` field must explicitly name the perspective and
  explain how the chosen PageTypes serve it. One sentence, no filler.`,

  plan: `STAGE: Planner
You are deciding which PageTypes apply to each source. Prioritize PageTypes
that the perspective makes load-bearing; drop PageTypes that the perspective
would not surface even if the source technically contains evidence for them.
A source might contain background content that "matches" a PageType under a
literal read — skip it if the PERSPECTIVE would not act on it.`,

  research: `STAGE: Researcher
You are extracting findings from raw source text. The PERSPECTIVE is the
filter: a finding is worth extracting ONLY if a perspective-holder would
ACT on it (open a deal, write a scene, revisit a decision, cite a claim).
- Skip "background context" findings — every finding must produce a TAKEAWAY
  under the perspective.
- Lift verbatim quotes that the perspective makes evidentiary. Paraphrase
  is a failure mode here; the chat layer re-displays these quotes to users
  who clicked through the citation.
- Title each finding the way a perspective-holder would refer to it. Generic
  noun-phrase titles ("Validation sets purpose") are wrong when the
  perspective demands a finding-shaped title ("ML practitioners overspend on
  validation tooling because purpose is muddied").`,

  draft: `STAGE: Drafter
You are writing the page body. Open with the IMPLICATION under the
perspective, not with "background context". The first paragraph must read
as if a perspective-holder wrote it for a perspective-holder reader. Title,
section headings, and body voice all in the perspective's vocabulary.

If you find yourself producing prose that could appear in any generic
encyclopedia article, STOP and re-anchor on the perspective. Generic prose
in a perspective-tuned wiki is a bug.`,

  narrate: `STAGE: Narrator
You are writing the wiki's thesis, per-section narratives, and glossary.
- The thesis must state what this wiki IS UNDER THE PERSPECTIVE. Not "this
  is a wiki about music and biking and AI" — "this is a wiki of business
  opportunities visible in a corpus of music, biking, and AI content".
- Per-section narratives must explain what role each PageType plays
  IN THE PERSPECTIVE'S FRAME — not what it is in the abstract.
- Glossary terms are the vocabulary a perspective-holder needs to navigate
  THIS wiki. If a term is generic to the field but irrelevant to the
  perspective, drop it.`,
};

const UNIVERSAL_ENFORCEMENT = `This perspective is a HARD CONSTRAINT on your output, not a soft suggestion. The user paid for a wiki built UNDER THIS LENS — produce that, not a generic wiki of the corpus.

Rules:
1. Every PageType name, every page title, every section heading must read as if a perspective-holder authored it. Generic / topical alternatives are failures.
2. Rank what to include by the perspective's priorities. Content the perspective doesn't make actionable gets dropped, not summarized.
3. Frame every finding around its IMPLICATION under the perspective, not its place in its source document. The same Constitutional AI paper read under "business opportunities" produces market-signal pages, NOT pages about the technique in the abstract.
4. If you catch yourself producing output that could come from any wiki of any corpus on any topic, STOP and re-anchor. Generic = wrong.
5. Structural rules in the prompt below (allowed PageType values, citation span format, claim grounding) always win — you may reshape WHAT you say, but never invent citations or break the schema.

If the corpus and the perspective genuinely don't intersect, say so clearly in the page bodies / narrative thesis. Don't silently snap back to corpus-shape and pretend the perspective wasn't supplied.`;

export interface WithPerspectiveOpts {
  /** Which compile stage this prompt belongs to. Drives the
   *  stage-specific enforcement clause appended after the universal
   *  rules. Omit when calling from contexts that don't fit the five
   *  documented stages. */
  stage?: PerspectiveStage;
}

/**
 * Prepend a high-enforcement PERSPECTIVE block to a system prompt when
 * the user supplied a compile-level perspective. No-op when perspective
 * is empty / undefined — the original system prompt is returned
 * unchanged so the "generic compile" path stays byte-identical.
 *
 * The preamble sits at the TOP of the system message (model-trusted
 * channel) so prompt-injected content inside sources can't override
 * it. Universal enforcement always runs; per-stage clauses sharpen the
 * directive for the specific output shape.
 */
export const withPerspective = (
  systemPrompt: string,
  perspective: string | undefined,
  opts: WithPerspectiveOpts = {},
): string => {
  if (!perspective) return systemPrompt;
  const trimmed = perspective.trim();
  if (trimmed.length === 0) return systemPrompt;
  const stageClause = opts.stage ? `\n\n${STAGE_DIRECTIVES[opts.stage]}` : '';
  return `========================================================================
PERSPECTIVE (load-bearing — read first, apply throughout):

${trimmed}

------------------------------------------------------------------------
${UNIVERSAL_ENFORCEMENT}${stageClause}
========================================================================

${systemPrompt}`;
};

/**
 * Compose a short reminder header to prepend to the USER message. The
 * model treats user messages as the primary signal, so a one-line
 * perspective restatement here meaningfully reinforces the system
 * preamble — repetition is the most reliable enforcement we have short
 * of fine-tuning. No-op when perspective is empty.
 */
export const perspectiveUserHeader = (perspective: string | undefined): string => {
  if (!perspective) return '';
  const trimmed = perspective.trim();
  if (trimmed.length === 0) return '';
  // Keep the header tight — the full perspective is already in the
  // system prompt. This reminder just keeps the lens in the model's
  // working attention when it's processing the source content.
  return `Reminder — apply the PERSPECTIVE from the system message to everything below. PageType names, titles, and findings must reflect that lens, not the corpus's literal shape.\n\n`;
};
