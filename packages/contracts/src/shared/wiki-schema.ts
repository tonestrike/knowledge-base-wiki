import { z } from 'zod';

const PascalCase = z.string().regex(/^[A-Z][A-Za-z0-9]+$/, {
  message: 'must be PascalCase',
});

export const PageType = z.object({
  name: PascalCase,
  description: z.string().min(1).max(280),
});
export type PageType = z.infer<typeof PageType>;

export const Cardinality = z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']);
export type Cardinality = z.infer<typeof Cardinality>;

export const Relation = z.object({
  name: PascalCase,
  from: PascalCase,
  to: PascalCase,
  cardinality: Cardinality,
});
export type Relation = z.infer<typeof Relation>;

export const WikiSchema = z
  .object({
    pageTypes: z.array(PageType).min(1).max(20),
    relations: z.array(Relation).max(40),
    /**
     * Optional opinionated thesis written by the Narrator pass at compile
     * time: 2-3 sentences naming what this corpus is about, what
     * perspective the wiki takes, and how its sections fit together.
     * Surfaced at the top of the wiki overview page so readers can
     * navigate by intent rather than alphabet (Karpathy LLM-Wiki style).
     * Optional because pre-Narrator wikis compiled without it.
     */
    thesis: z.string().min(1).max(800).optional(),
    /**
     * Optional glossary of key terms extracted from the corpus. The
     * Narrator picks the terms a newcomer to this corpus would need to
     * recognize — proper nouns, technical methods, named phenomena —
     * and writes a single-sentence definition for each. Renders on the
     * wiki overview page as a sidebar/list; chat search treats it as a
     * lightweight term-disambiguation index.
     */
    glossary: z
      .array(
        z.object({
          term: z.string().min(1).max(80),
          definition: z.string().min(1).max(280),
        }),
      )
      .max(40)
      .optional(),
  })
  .superRefine((s, ctx) => {
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
export type WikiSchema = z.infer<typeof WikiSchema>;
