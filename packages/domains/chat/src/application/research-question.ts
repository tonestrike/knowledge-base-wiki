import type { Citation, WikiId } from '@package/contracts/shared';
import type { Researcher, ResearcherOutput, WikiReader } from './ports.ts';

/**
 * Drive the Researcher: prompt it with the candidate `WikiPage`s for a
 * `Question`, then validate every quote and citation id it returns against
 * the actual page bodies. The Researcher cannot invent a citation id — every
 * id it returns must appear in the candidate pages' `citations[]`.
 */
export async function researchQuestion(
  deps: { researcher: Researcher; wikiReader: WikiReader },
  input: { wikiId: WikiId; question: string },
): Promise<ResearcherOutput> {
  const out = await deps.researcher.research(input);

  // Validate that every cited id was actually present in the candidate pages.
  // The Researcher port is supposed to do this; we re-check in the use-case
  // because we don't trust adapters to keep their guarantee through future
  // refactors.
  const citationsByPage = new Map<string, Map<string, Citation>>();
  for (const p of out.pages) {
    const m = new Map<string, Citation>();
    for (const c of p.citations) m.set(c.id, c);
    citationsByPage.set(p.id, m);
  }
  const findings = out.findings.flatMap((f) => {
    const idx = citationsByPage.get(f.wikiPageId);
    if (!idx) return [];
    const cites: Citation[] = [];
    for (const id of f.citationIds) {
      const c = idx.get(id);
      if (c) cites.push(c);
    }
    if (cites.length === 0) return [];
    return [{ ...f, citations: cites }];
  });

  return { pages: out.pages, findings };
}
