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
