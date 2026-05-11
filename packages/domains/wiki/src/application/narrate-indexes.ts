import type { WikiSchema } from '@package/contracts/shared';
import { z } from 'zod';
import { withPerspective } from './perspective-preamble.ts';
import type { LlmClient } from './ports.ts';

// Narrator — runs once per CompileRun, after Drafter, before IndexBuilder.
// Light enough to use the same Haiku tier as Planner; the output is
// short, fixed-shape, and reused once across N IndexPages.
export const NARRATOR_MODEL = 'anthropic/claude-haiku-4.5';

const NarrateOutput = z.object({
  thesis: z
    .string()
    .min(1)
    .describe(
      "Two to three sentences naming this wiki's center of gravity — what the corpus is about, what perspective the wiki takes, and how it's organized.",
    ),
  pageTypeNarratives: z.array(
    z.object({
      pageType: z.string(),
      narrative: z
        .string()
        .min(1)
        .describe(
          'One or two sentences explaining what entries of this page type contribute to the wiki, in this corpus specifically. NOT a generic definition — name what makes this page type distinct here.',
        ),
    }),
  ),
  glossary: z
    .array(
      z.object({
        term: z.string().min(1).max(80),
        definition: z.string().min(1).max(280),
      }),
    )
    .describe(
      'Key terms a newcomer to THIS corpus would need to recognize — proper nouns, named techniques, distinctive phenomena. Up to ~20 entries; one-sentence definitions; no filler like "see also" or generic dictionary entries.',
    ),
});

export interface NarrateOutputT {
  thesis: string;
  pageTypeNarratives: Array<{ pageType: string; narrative: string }>;
  glossary: Array<{ term: string; definition: string }>;
}

/**
 * Generate an opinionated narrative for the wiki and for each PageType in
 * the schema. The narratives are written specifically about *this* corpus
 * — naming what makes each domain distinct here — rather than the
 * generic "This index lists every X" template the deterministic
 * IndexBuilder produces.
 *
 * Why this exists: a wiki of 10 alignment-research papers shouldn't
 * advertise its `Phenomenon` index as "This index lists every
 * Phenomenon"; it should say "Phenomena in this corpus are the
 * observed failure modes — alignment faking, sycophancy, deceptive
 * instrumental alignment — that motivate the Techniques section." The
 * Karpathy-style framing the user is after.
 *
 * Inputs are bounded by the caller (Drafter output titles + first claim
 * teasers): keeps the prompt cost steady regardless of corpus size.
 */
export async function narrateIndexes(
  deps: { llm: LlmClient },
  input: {
    schema: WikiSchema;
    /** Concept-page titles grouped by pageType. Limit ~6 titles per type
     *  upstream so the prompt stays compact. */
    entriesByPageType: Record<string, ReadonlyArray<{ title: string; teaser?: string }>>;
    /** Folder display name when known — gives the model a topical anchor. */
    folderName?: string;
    /** Compile-level perspective; threaded into the system prompt so the
     *  narrative + glossary frame the corpus through the user's lens. */
    perspective?: string;
  },
): Promise<NarrateOutputT> {
  const sections = input.schema.pageTypes
    .map((pt) => {
      const entries = input.entriesByPageType[pt.name] ?? [];
      const entryLines = entries.length
        ? entries
            .slice(0, 6)
            .map((e) => `  - ${e.title}${e.teaser ? ` — ${e.teaser.slice(0, 140)}` : ''}`)
            .join('\n')
        : '  (no concept pages yet)';
      return `### ${pt.name}\n${pt.description}\nEntries:\n${entryLines}`;
    })
    .join('\n\n');

  const SYSTEM = `You are the Wiki Narrator. Your job is to produce an opinionated description of THIS wiki — what's distinct about its corpus, how its sections fit together, and the key terms a newcomer needs — so readers can navigate by intent rather than alphabet.

Style:
- Concrete. Name the actual phenomena / models / methods in the corpus.
- Take a view. "Phenomena are the failure modes that motivate the Techniques" beats "Phenomena are observed behaviors".
- No filler. No "this index lists…", no "in this section you will find…".
- Two short sentences max per narrative. Three for the thesis.

Glossary rules:
- Pick 8-20 terms a newcomer would actually need: proper nouns from the corpus (paper names, model names, method names), distinctive technical phrases ("induction head", "sleeper agent"), domain-specific verbs.
- Skip generic terms anyone in the field already knows (no "machine learning", no "model", no "training").
- One sentence per term. Define what the term means HERE, not in general.

You are NOT writing about page types in general — you are writing about page types as instantiated by THIS corpus.`;

  const folderLine = input.folderName ? `Folder: ${input.folderName}\n\n` : '';
  const { result } = await deps.llm.generateObject({
    model: NARRATOR_MODEL,
    system: withPerspective(SYSTEM, input.perspective),
    prompt: `${folderLine}WikiSchema sections (PageType, description, sample concept entries):\n\n${sections}`,
    schema: NarrateOutput,
    schemaName: 'WikiNarrative',
    schemaDescription:
      "Opinionated thesis for the wiki + a per-pageType narrative explaining each section's role in this corpus.",
    maxTokens: 1500,
    temperature: 0.4,
  });

  // Defense: drop narratives for pageTypes not in the schema (model
  // occasionally invents one). Keep schema order so downstream rendering
  // is deterministic.
  const known = new Set(input.schema.pageTypes.map((p) => p.name));
  const byName = new Map(
    result.pageTypeNarratives
      .filter((n) => known.has(n.pageType))
      .map((n) => [n.pageType, n.narrative]),
  );
  const ordered = input.schema.pageTypes
    .map((pt) => ({ pageType: pt.name, narrative: byName.get(pt.name) }))
    .filter((n): n is { pageType: string; narrative: string } => typeof n.narrative === 'string');

  // Glossary: deduplicate by term (case-insensitive) and cap at 40 to
  // match the contract bound. We trust the model on definition quality;
  // post-filtering content would require a second pass.
  const seenTerms = new Set<string>();
  const glossary: Array<{ term: string; definition: string }> = [];
  for (const g of result.glossary) {
    const key = g.term.trim().toLowerCase();
    if (!key || seenTerms.has(key)) continue;
    seenTerms.add(key);
    glossary.push({ term: g.term.trim(), definition: g.definition.trim() });
    if (glossary.length >= 40) break;
  }

  return { thesis: result.thesis, pageTypeNarratives: ordered, glossary };
}
