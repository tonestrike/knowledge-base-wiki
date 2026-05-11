/**
 * Tiny helper: prepend a "Perspective:" preamble to a system prompt when
 * the user supplied a compile-level perspective. Keeps the formatting
 * consistent across the five compile prompts (SchemaInferrer, PlanCompile,
 * ResearchSource, DraftPage, NarrateIndexes) so a perspective set on the
 * compile run actually changes every prompt's output, not just one.
 *
 * No-op when `perspective` is empty / undefined — the original system
 * prompt is returned unchanged so the "generic compile" path stays
 * byte-identical to the pre-perspective build.
 *
 * The preamble is placed at the TOP of the system message rather than
 * the user message so the model can't be tricked into ignoring it via
 * prompt-injected content in the sources. Each downstream prompt's
 * Rules: section follows; the perspective biases what counts as
 * relevant content, but the structural rules (PageType naming, citation
 * spans, claim grounding) always win.
 */
export const withPerspective = (systemPrompt: string, perspective: string | undefined): string => {
  if (!perspective) return systemPrompt;
  const trimmed = perspective.trim();
  if (trimmed.length === 0) return systemPrompt;
  return `Perspective:
${trimmed}

The above perspective is the lens the user wants applied to this corpus. When you make choices — which PageTypes to surface, which findings to extract, how to phrase a page, how to introduce a section — bias toward what is interesting and useful UNDER THIS LENS. Don't ignore other content the corpus contains, but rank, emphasize, and frame through the perspective.

---

${systemPrompt}`;
};
