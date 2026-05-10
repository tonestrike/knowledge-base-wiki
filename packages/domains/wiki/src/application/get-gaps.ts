import type { WikiId } from '@package/contracts/shared';
import type { Gap, GapsOutput } from '@package/contracts/wiki';
import type { GapAnalyzer, WikiDeps } from './ports.ts';

/**
 * Wiki health report. Surfaces structural gaps a user can act on:
 *
 * - `PageTypeHasNoPages` — schema-inferred PageType the Drafter never
 *   produced a page for (likely a coverage gap in the corpus or a
 *   schema misjudgment).
 * - `PageHasNoClaims` — a Concept page whose body has prose but no
 *   grounded claims (can't be lint-verified, untrustworthy).
 * - `ClaimHasNoCitations` — claim that asserts something but has no
 *   source attribution (a verification hazard).
 * - `SourceNeverCited` — source ingested but no citation in the wiki
 *   references it (not necessarily a bug, but flags coverage).
 */
export async function getGaps(
  deps: Pick<WikiDeps, 'wikis' | 'gapAnalyzer' | 'now'>,
  input: { id: WikiId },
): Promise<GapsOutput> {
  const wiki = await deps.wikis.findById(input.id);
  if (!wiki) throw new Error(`Wiki not found: ${input.id}`);

  const analysis = await deps.gapAnalyzer.analyze(input.id);

  const gaps: Gap[] = [];
  for (const g of analysis.pageTypeWithNoPages) {
    gaps.push({ kind: 'PageTypeHasNoPages', pageType: g.pageType, description: g.description });
  }
  for (const g of analysis.pagesWithNoClaims) {
    gaps.push({
      kind: 'PageHasNoClaims',
      pageId: g.pageId,
      title: g.title,
      pageType: g.pageType,
    });
  }
  for (const g of analysis.claimsWithNoCitations) {
    gaps.push({
      kind: 'ClaimHasNoCitations',
      pageId: g.pageId,
      pageTitle: g.pageTitle,
      claimId: g.claimId,
      claimText: g.claimText,
    });
  }
  for (const g of analysis.sourcesNeverCited) {
    gaps.push({ kind: 'SourceNeverCited', sourceId: g.sourceId, filename: g.filename });
  }

  return {
    wikiId: input.id,
    generatedAt: deps.now().toISOString(),
    totalGaps: gaps.length,
    gaps,
  };
}

// Re-export so test-supports / build-wiki-deps can ship a fake.
export type { GapAnalyzer };
