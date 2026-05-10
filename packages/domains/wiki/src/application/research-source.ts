import { z } from 'zod';
import type { ExtractedSourceText, LlmClient } from './ports.ts';

// Researcher — high volume, runs N times per CompileRun (one per source).
export const RESEARCHER_MODEL = 'anthropic/claude-haiku-4.5';

// Lenient schema — orchestrator clamps + filters in post. Strict refinements
// here caused multi-source compiles to fail at the structured-output gate
// (4-of-5 sources rejected with "No object generated"); the LLM occasionally
// emits 21+ findings or evidence over the 800-char ceiling. Constraints are
// now hints in the prompt, not gates in the schema.
const FindingSchema = z.object({
  pageType: z.string(),
  title: z.string().min(1),
  evidence: z.string().min(1),
  spanStart: z.number().int().nonnegative(),
  spanEnd: z.number().int().positive(),
});

const ResearchOutput = z.object({
  findings: z.array(FindingSchema),
});

const SYSTEM = `You are Researcher. Given one source's text and a list of PageTypes, extract typed findings.

Rules:
- Each finding MUST include the byte range (spanStart, spanEnd) within the source text where the supporting evidence lives.
- The "evidence" field must be the verbatim quote from the source within that byte range. Do NOT paraphrase.
- The pageType MUST be one of the provided PageTypes.
- Return up to 20 findings. Skip a (PageType, source) pair entirely if there is no evidence — do NOT invent.

Return JSON: { findings: [{ pageType, title, evidence, spanStart, spanEnd }] }.`;

export interface ResearchOutputT {
  findings: Array<{
    pageType: string;
    title: string;
    evidence: string;
    spanStart: number;
    spanEnd: number;
  }>;
}

export async function researchSource(
  deps: { llm: LlmClient },
  input: { source: ExtractedSourceText; pageTypes: string[] },
): Promise<ResearchOutputT> {
  const known = new Set(input.pageTypes);
  const { result } = await deps.llm.generateObject({
    model: RESEARCHER_MODEL,
    system: SYSTEM,
    // Trim source text to first 60K chars (~20 pages) so Sonnet can pull
    // findings from a substantial chunk while leaving headroom for 20 JSON
    // findings. Earlier 10K cap was too small for 500-page legal docs;
    // 60K hits the sweet spot for the demo dataset.
    prompt: `PageTypes: ${input.pageTypes.join(', ')}\n\n<source filename="${input.source.filename}">\n${input.source.text.slice(0, 60000)}\n</source>`,
    schema: ResearchOutput,
    schemaName: 'ResearchOutput',
    schemaDescription: 'Typed findings extracted from one source.',
    // 20 findings × ~200 evidence chars = 4–6K tokens of content; bump to
    // 8000 so the model never truncates mid-array. Truncated JSON was the
    // failure mode for 4 of 5 sources at maxTokens=2000.
    maxTokens: 8000,
    temperature: 0.2,
  });
  // Defense in depth: drop findings whose pageType drifted off-list, and
  // clamp byte ranges to the source text length.
  const len = input.source.text.length;
  // Cap to 20, drop any spanEnd <= spanStart, drop unknown pageTypes.
  const sane = result.findings.filter((f) => f.spanEnd > f.spanStart).slice(0, 20);
  const kept = sane.filter((f) => known.has(f.pageType));
  const dropped = sane.filter((f) => !known.has(f.pageType));
  console.info(
    `[Researcher] ${input.source.filename}: ${result.findings.length} raw → ${kept.length} kept (dropped pageTypes: ${[...new Set(dropped.map((f) => f.pageType))].join(', ') || 'none'})`,
  );
  return {
    findings: kept.map((f) => ({
      ...f,
      spanStart: Math.max(0, Math.min(f.spanStart, len)),
      spanEnd: Math.max(f.spanStart + 1, Math.min(f.spanEnd, len)),
    })),
  };
}
