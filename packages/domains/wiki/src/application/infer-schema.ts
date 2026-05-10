import {
  PageType,
  Relation,
  type WikiSchema as TWikiSchema,
  WikiSchema,
} from '@package/contracts/shared';
import { z } from 'zod';
import type { ExtractedSourceText, LlmClient } from './ports.ts';

// SchemaInferrer model — quality matters; one inference per CompileRun.
// Pinned to 4.6 per spec §5.1.1 + the 1.A risk spike.
export const SCHEMA_MODEL = 'anthropic/claude-sonnet-4.6';

// We re-compose the schema rather than `.and()`-ing onto WikiSchema because
// WikiSchema uses superRefine (zod refinements survive .and(), but the
// generateObject call lifts schema description from .shape — flat shape is
// friendlier to JSON-Schema generation in @ai-sdk/anthropic).
//
// Important: Anthropic's `output_config.format.schema` validator rejects
// `maxItems` on arrays ("For 'array' type, property 'maxItems' is not
// supported"). The previous `.min(1).max(20)` / `.max(40)` constraints
// compiled to that and 400-ed the whole compile. The caps now live in
// the system prompt and are enforced with a Zod `.refine` (which is a
// post-stream validation, not part of the JSON Schema).
const InferOutput = z
  .object({
    pageTypes: z.array(PageType).min(1),
    relations: z.array(Relation),
    reason: z.string().min(1).max(800),
  })
  .superRefine((s, ctx) => {
    if (s.pageTypes.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `too many PageTypes: ${s.pageTypes.length} (cap 20)`,
      });
    }
    if (s.relations.length > 40) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `too many Relations: ${s.relations.length} (cap 40)`,
      });
    }
    const known = new Set(s.pageTypes.map((p) => p.name));
    for (const r of s.relations) {
      if (!known.has(r.from) || !known.has(r.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `relation "${r.name}" references unknown PageType (from=${r.from}, to=${r.to})`,
        });
      }
    }
  });

const SYSTEM = `You are SchemaInferrer. Read the first sources of a folder and return a typed wiki schema describing the SHAPE of knowledge in this folder.

Rules:
- Each PageType name MUST be PascalCase, single word preferred ("Decision", not "Board Decision").
- Pick 3-7 PageTypes that meaningfully partition the content.
- Relations connect known PageTypes. Cardinality is one of "one-to-one", "one-to-many", "many-to-one", "many-to-many".
- Do NOT exceed 7 PageTypes or 12 Relations total.
- Return ONLY structured JSON matching the schema: { pageTypes: [{ name, description }], relations: [{ name, from, to, cardinality }], reason }.
- The "reason" is one short sentence the user will read out loud as part of the live demo. e.g. "This folder is about board governance. I'll build pages for: Decision, Metric, Person, Risk."`;

export async function inferSchema(
  deps: { llm: LlmClient },
  input: { sources: ExtractedSourceText[] },
): Promise<{ schema: TWikiSchema; reason: string }> {
  const sample = input.sources
    .slice(0, 10)
    .map(
      (s, i) => `<source idx="${i}" filename="${s.filename}">\n${s.text.slice(0, 6000)}\n</source>`,
    )
    .join('\n');

  const { result } = await deps.llm.generateObject({
    model: SCHEMA_MODEL,
    system: SYSTEM,
    prompt: sample,
    schema: InferOutput,
    schemaName: 'WikiSchemaWithReason',
    schemaDescription: 'A typed schema for the folder plus a one-sentence reason.',
    maxTokens: 1500,
    temperature: 0.2,
  });

  // Validate the schema with the canonical contract (defense in depth — the
  // input schema was a copy of the rules, but a roundtrip catches drift).
  const schema = WikiSchema.parse({
    pageTypes: result.pageTypes,
    relations: result.relations,
  });
  return { schema, reason: result.reason };
}
