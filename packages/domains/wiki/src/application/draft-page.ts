import {
  type ContentHash,
  type SourceId,
  sourceId as parseSourceId,
} from '@package/contracts/shared';
import { z } from 'zod';
import type { LlmClient } from './ports.ts';

// Drafter — prose quality is the surface a reader judges.
// Pinned to 4.6 per spec §5.1.1 + the 1.A risk spike.
export const DRAFTER_MODEL = 'anthropic/claude-sonnet-4.6';

const DraftOutput = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
  body: z.string().min(1),
  claims: z
    .array(
      z.object({
        paragraphId: z.string().min(1),
        claimText: z.string().min(1).max(2000),
        citations: z
          .array(
            z.object({
              sourceId: z.string().uuid(),
              spanStart: z.number().int().nonnegative(),
              spanEnd: z.number().int().positive(),
              label: z.string().min(1).max(200),
            }),
          )
          // Bedrock rejects minItems > 1 — encode in prompt + post-validate.
          .refine((arr) => arr.length >= 1, {
            message: 'each claim requires at least one citation',
          }),
      }),
    )
    .refine((arr) => arr.length >= 1, {
      message: 'a page draft needs at least one claim',
    }),
});

const SYSTEM = `You are Drafter. Compose a magazine-quality wiki page in markdown.

Rules:
- Title: a short noun phrase ("Decision: Expand into EMEA in Q4"), not a sentence.
- Slug: kebab-case, lowercase, no spaces. Example: "expand-into-emea".
- Body: 3-6 short sections with H2 headings; serif-prose register.
- Each meaningful claim in the body must be paired with a citation.
- Each citation MUST point to one of the provided findings by (sourceId, spanStart, spanEnd) — DO NOT invent byte ranges.
- The "label" is what the reader sees on the chip (e.g. "Q3 minutes, p.4"). Make it specific.
- Each claim has 1+ citations.

Return JSON: { title, slug, body, claims: [{ paragraphId, claimText, citations: [{ sourceId, spanStart, spanEnd, label }] }] }.`;

export interface ResearchFinding {
  sourceId: SourceId;
  sourceFilename: string;
  sourceText: string;
  sourceContentHash: ContentHash;
  evidence: string;
  spanStart: number;
  spanEnd: number;
  title: string;
}

export interface DraftedClaim {
  paragraphId: string;
  claimText: string;
  citations: Array<{
    sourceId: SourceId;
    spanStart: number;
    spanEnd: number;
    label: string;
    sourceContentHash: ContentHash;
  }>;
}

export interface DraftedPage {
  title: string;
  slug: string;
  body: string;
  claims: DraftedClaim[];
}

export async function draftPage(
  deps: { llm: LlmClient },
  input: { pageType: string; findings: ResearchFinding[] },
): Promise<{
  draft: DraftedPage;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const findingsBlock = input.findings
    .map(
      (f) =>
        `<finding sourceId="${f.sourceId}" filename="${f.sourceFilename}" spanStart="${f.spanStart}" spanEnd="${f.spanEnd}">\n${f.evidence}\n</finding>`,
    )
    .join('\n');

  const { result, inputTokens, outputTokens } = await deps.llm.generateObject({
    model: DRAFTER_MODEL,
    system: SYSTEM,
    prompt: `PageType: ${input.pageType}\n\nFindings:\n${findingsBlock}`,
    schema: DraftOutput,
    schemaName: 'DraftedPage',
    schemaDescription: 'A markdown wiki page with cited claims.',
    maxTokens: 3000,
    temperature: 0.3,
  });

  // Snap citations back to known findings — the Drafter doesn't get to invent
  // contentHashes; the orchestrator owns provenance.
  const byId = new Map(input.findings.map((f) => [f.sourceId, f]));
  const enrichedClaims: DraftedClaim[] = result.claims.map((c) => ({
    paragraphId: c.paragraphId,
    claimText: c.claimText,
    citations: c.citations.map((cite) => {
      const sid = parseSourceId(cite.sourceId);
      const finding = byId.get(sid);
      if (!finding) {
        throw new Error(`Drafter cited unknown sourceId: ${cite.sourceId}`);
      }
      return {
        sourceId: sid,
        spanStart: cite.spanStart,
        spanEnd: cite.spanEnd,
        label: cite.label,
        sourceContentHash: finding.sourceContentHash,
      };
    }),
  }));

  return {
    draft: {
      title: result.title,
      slug: result.slug,
      body: result.body,
      claims: enrichedClaims,
    },
    usage: { inputTokens, outputTokens },
  };
}
