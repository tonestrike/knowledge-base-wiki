/**
 * # draftPage — the Drafter stage
 *
 * Stage 4 of compileFolder. Called once per `(pageType, normalizedTitle)`
 * bucket of related Researcher findings. Produces one Concept page:
 *
 *     { title, slug, body, claims: [{ paragraphId, claimText, citations }] }
 *
 * The body is markdown (~3-6 H2 sections, magazine-quality prose).
 * Each claim in the body must be paired with a citation pointing back
 * to a finding by `(sourceId, spanStart, spanEnd)`. The orchestrator
 * then hashes the source slice and binds the resulting `contentHash`
 * onto a real Citation entity — the Drafter never sees content hashes.
 *
 * ## Why the Drafter doesn't invent contentHashes
 *
 * Provenance is owned by the orchestrator. Letting the model emit
 * hash values would let it pretend a quote came from a source — the
 * verification tripwire would never catch the lie because the hash
 * would self-consistently match a quote the model just invented.
 * Keeping hashes out of the Drafter's schema forces every citation
 * through the (sourceId, byteRange) → hash pipeline.
 *
 * ## Model choice
 *
 * Pinned to Sonnet 4.6 because prose quality is the surface a reader
 * judges first. The other LLM stages can use Haiku; this one cannot.
 *
 * ## Perspective enforcement at this stage
 *
 * The draft-stage clause (perspective-preamble.ts
 * STAGE_DIRECTIVES.draft) demands that the page opens with the
 * IMPLICATION under the perspective — not "background context." If
 * the model produces prose that could appear in any generic
 * encyclopedia, that's a failure mode the clause names explicitly.
 */
import {
  type ContentHash,
  type SourceId,
  sourceId as parseSourceId,
} from '@package/contracts/shared';
import { z } from 'zod';
import { perspectiveUserHeader, withPerspective } from './perspective-preamble.ts';
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
              // Anthropic's output_config.format.schema rejects `minimum`
              // on integer fields; the orchestrator clamps the byteRange
              // before persisting (see `Math.max(cite.spanStart + 1, …)`).
              spanStart: z.number().int(),
              spanEnd: z.number().int(),
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
  input: { pageType: string; findings: ResearchFinding[]; perspective?: string },
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
    system: withPerspective(SYSTEM, input.perspective, { stage: 'draft' }),
    prompt: `${perspectiveUserHeader(input.perspective)}PageType: ${input.pageType}\n\nFindings:\n${findingsBlock}`,
    schema: DraftOutput,
    schemaName: 'DraftedPage',
    schemaDescription: 'A markdown wiki page with cited claims.',
    maxTokens: 8000,
    temperature: 0.3,
  });

  // Snap citations back to known findings — the Drafter doesn't get to invent
  // contentHashes; the orchestrator owns provenance. Drop bad citations
  // (unknown sourceId is a common LLM hallucination) rather than throwing;
  // skip the whole claim if every citation was bad. If *every* claim ends
  // up with no citations, throw — a zero-claim page is a verification
  // hazard (no spans for the lint pass to check).
  const byId = new Map(input.findings.map((f) => [f.sourceId, f]));
  const enrichedClaims: DraftedClaim[] = [];
  for (const c of result.claims) {
    const goodCitations = [];
    for (const cite of c.citations) {
      const sid = parseSourceId(cite.sourceId);
      const finding = byId.get(sid);
      if (!finding) continue;
      goodCitations.push({
        sourceId: sid,
        spanStart: cite.spanStart,
        spanEnd: Math.max(cite.spanStart + 1, cite.spanEnd),
        label: cite.label,
        sourceContentHash: finding.sourceContentHash,
      });
    }
    if (goodCitations.length === 0) continue;
    enrichedClaims.push({
      paragraphId: c.paragraphId,
      claimText: c.claimText,
      citations: goodCitations,
    });
  }
  if (enrichedClaims.length === 0) {
    throw new Error(
      'Drafter produced no claims with valid citations (all citations referenced unknown sourceIds)',
    );
  }

  // Force kebab-case post-hoc — schema is now lenient on slug shape.
  const kebabSlug =
    result.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'untitled';

  return {
    draft: {
      title: result.title,
      slug: kebabSlug,
      body: result.body,
      claims: enrichedClaims,
    },
    usage: { inputTokens, outputTokens },
  };
}
