import {
  type Relation,
  type WikiPageId,
  wikiPageId as parsePageId,
} from '@package/contracts/shared';
import { Backlink } from '../domain/backlink.ts';
import type { WikiPage } from '../domain/wiki-page.ts';

// Linker — pure code, no LLM. Reads the markdown bodies, extracts links of
// the form `](/<uuid>)`, and resolves them against the page set.
// Arity validation is owned by Wiki.addBacklinks now (TD1) — this function
// only resolves candidate edges from markdown.
const LINK_RE = /\]\(\/([0-9a-f-]{36})\)/gi;

export function resolveBacklinks(
  pages: ReadonlyArray<WikiPage>,
  relations: ReadonlyArray<Relation>,
): { backlinks: Backlink[] } {
  const knownIds = new Set<WikiPageId>(pages.map((p) => p.id));
  // Only Concept + Index pages carry a pageType; Summary/Answer pages have
  // none, so they can't participate as either end of a typed Relation.
  const pageTypeOf = (p: WikiPage): string =>
    p.subtype === 'Concept' || p.subtype === 'Index' ? p.pageType : '';
  const byPageType = new Map<WikiPageId, string>(pages.map((p) => [p.id, pageTypeOf(p)]));
  const out: Backlink[] = [];

  for (const page of pages) {
    LINK_RE.lastIndex = 0;
    const seen = new Set<string>();
    for (const m of page.body.matchAll(LINK_RE)) {
      const targetIdRaw = m[1];
      if (!targetIdRaw) continue;
      let targetId: WikiPageId;
      try {
        targetId = parsePageId(targetIdRaw);
      } catch {
        continue;
      }
      if (!knownIds.has(targetId) || targetId === page.id) continue;
      if (seen.has(targetIdRaw)) continue;
      seen.add(targetIdRaw);

      const fromType = byPageType.get(page.id) ?? '';
      const toType = byPageType.get(targetId) ?? '';
      const relation = relations.find((r) => r.from === fromType && r.to === toType);

      out.push(
        Backlink.create({
          fromPageId: page.id,
          toPageId: targetId,
          relationName: relation?.name,
        }),
      );
    }
  }

  return { backlinks: out };
}
