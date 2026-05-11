/**
 * # planCompile — the Planner stage
 *
 * Stage 2 of compileFolder. Given the schema's PageTypes + every
 * source's text, decides which PageTypes the Researcher should look
 * for in each source. Output is a flat task list:
 *
 *     [{ sourceId, pageTypes: [...] }, ...]
 *
 * The Researcher iterates this list (one LLM call per source) and
 * extracts findings only for the assigned PageTypes — so what the
 * Planner picks here directly determines which sections of the wiki
 * get populated.
 *
 * ## Why a separate stage instead of "extract everything per source"
 *
 * Two reasons:
 *
 *   1. **Cost** — emitting a "draft 6 page types" instruction to a
 *      strong model on a 30-page PDF takes ~30s. The Planner uses
 *      Haiku and runs once over every source's first 3KB at low
 *      temperature — a few seconds total. It pre-filters so the
 *      Researcher only gets sensible (source, pageType) pairs.
 *   2. **Perspective enforcement** — when the user picks a perspective,
 *      the planner's stage clause tells it to assign 3+ PageTypes per
 *      source so the same source produces findings for Opportunity,
 *      Pain, Wedge, etc. — not just the single topically-obvious one.
 *      That fan-out is THE fix for "schema looked great but only Tool
 *      had pages." See perspective-preamble.ts STAGE_DIRECTIVES.plan.
 *
 * Defense in depth: the Researcher AND the orchestrator both filter
 * pageType names against the schema — a hallucinated PageType here
 * just gets dropped.
 */
import {
  type SourceId,
  type WikiSchema,
  sourceId as parseSourceId,
} from '@package/contracts/shared';
import { z } from 'zod';
import { perspectiveUserHeader, withPerspective } from './perspective-preamble.ts';
import type { ExtractedSourceText, LlmClient } from './ports.ts';

// Planner — mechanical decomposition. Cheap model, fast.
export const PLANNER_MODEL = 'anthropic/claude-haiku-4.5';

const PlanOutput = z.object({
  tasks: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        // Bedrock rejects JSON-Schema minItems/maxItems other than 0/1 — encode
        // the cap in the prompt and post-validate via .refine() instead.
        pageTypes: z.array(z.string()).refine((arr) => arr.length >= 1 && arr.length <= 8, {
          message: 'pageTypes must have between 1 and 8 entries',
        }),
      }),
    )
    .refine((arr) => arr.length <= 50, {
      message: 'too many tasks; expected at most 50',
    }),
});

const SYSTEM = `You are Planner. For each source, decide which PageTypes (from the provided WikiSchema) are likely to be present in that source. Return JSON: { tasks: [{ sourceId, pageTypes }] }.

Rules:
- Cap pageTypes at 6 per source (1..6 inclusive).
- Drop a source from tasks entirely if you don't think any PageType applies.
- Echo the sourceId verbatim from the input. Do not invent UUIDs.`;

export async function planCompile(
  deps: { llm: LlmClient },
  input: { schema: WikiSchema; sources: ExtractedSourceText[]; perspective?: string },
): Promise<{ tasks: Array<{ sourceId: SourceId; pageTypes: string[] }> }> {
  const known = new Set(input.schema.pageTypes.map((p) => p.name));

  const { result } = await deps.llm.generateObject({
    model: PLANNER_MODEL,
    system: withPerspective(SYSTEM, input.perspective, { stage: 'plan' }),
    prompt: `${perspectiveUserHeader(input.perspective)}WikiSchema PageTypes: ${input.schema.pageTypes.map((p) => p.name).join(', ')}\n\n${input.sources
      .map(
        (s) =>
          `<source id="${s.sourceId}" filename="${s.filename}">\n${s.text.slice(0, 3000)}\n</source>`,
      )
      .join('\n')}`,
    schema: PlanOutput,
    schemaName: 'CompilePlan',
    schemaDescription: 'Per-source list of PageTypes to research.',
    maxTokens: 1200,
    temperature: 0,
  });

  console.info(
    `[Planner] in: ${input.sources.length} sources → out: ${result.tasks.length} tasks (raw); pageTypes per task: ${result.tasks.map((t) => t.pageTypes.length).join(',')}`,
  );
  const finalTasks = result.tasks.map((t) => ({
    sourceId: parseSourceId(t.sourceId),
    pageTypes: t.pageTypes.filter((pt) => known.has(pt)).slice(0, 6),
  }));
  console.info(
    `[Planner] post-filter: ${finalTasks.length} tasks; pageTypes per task: ${finalTasks.map((t) => t.pageTypes.length).join(',')}`,
  );
  return { tasks: finalTasks };
}
