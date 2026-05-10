import { z } from 'zod';
import type { ExtractedSourceText, LlmClient } from './ports.ts';

// Researcher — high volume, runs N times per CompileRun (one per source).
export const RESEARCHER_MODEL = 'anthropic/claude-haiku-4.5';

const FindingSchema = z
  .object({
    pageType: z.string(),
    title: z.string().min(1).max(160),
    evidence: z.string().min(1).max(800),
    spanStart: z.number().int().nonnegative(),
    spanEnd: z.number().int().positive(),
  })
  .refine((f) => f.spanEnd > f.spanStart, {
    message: 'spanEnd must be > spanStart',
  });

// Bedrock rejects JSON-Schema minItems/maxItems other than 0/1 — cap via .refine().
const ResearchOutput = z.object({
  findings: z.array(FindingSchema).refine((arr) => arr.length <= 20, {
    message: 'too many findings; max 20 per source',
  }),
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
    prompt: `PageTypes: ${input.pageTypes.join(', ')}\n\n<source filename="${input.source.filename}">\n${input.source.text}\n</source>`,
    schema: ResearchOutput,
    schemaName: 'ResearchOutput',
    schemaDescription: 'Typed findings extracted from one source.',
    maxTokens: 2000,
    temperature: 0.2,
  });
  // Defense in depth: drop findings whose pageType drifted off-list, and
  // clamp byte ranges to the source text length.
  const len = input.source.text.length;
  return {
    findings: result.findings
      .filter((f) => known.has(f.pageType))
      .map((f) => ({
        ...f,
        spanStart: Math.max(0, Math.min(f.spanStart, len)),
        spanEnd: Math.max(f.spanStart + 1, Math.min(f.spanEnd, len)),
      })),
  };
}
