import {
  type Relation,
  type WikiPageId,
  wikiPageId as parsePageId,
} from '@package/contracts/shared';
import { Backlink, validateRelationArity } from '../domain/backlink.ts';
import type { WikiPage } from '../domain/wiki-page.ts';

// Linker — pure code, no LLM. Reads the markdown bodies, extracts links of
// the form `](/<uuid>)`, and resolves them against the page set.
const LINK_RE = /\]\(\/([0-9a-f-]{36})\)/gi;

export function resolveBacklinks(
  pages: ReadonlyArray<WikiPage>,
  relations: ReadonlyArray<Relation>,
): { backlinks: Backlink[]; arityErrors: string[] } {
  const knownIds = new Set<WikiPageId>(pages.map((p) => p.id));
  const byPageType = new Map<WikiPageId, string>(pages.map((p) => [p.id, p.pageType ?? '']));
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

  const arityErrors = validateRelationArity(out, relations);
  return { backlinks: out, arityErrors };
}
