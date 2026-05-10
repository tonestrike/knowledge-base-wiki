import type { Cardinality, Relation, WikiPageId } from '@package/contracts/shared';

export interface Backlink {
  readonly fromPageId: WikiPageId;
  readonly toPageId: WikiPageId;
  readonly relationName?: string;
}

export const Backlink = {
  create(props: {
    fromPageId: WikiPageId;
    toPageId: WikiPageId;
    relationName?: string;
  }): Backlink {
    if (props.fromPageId === props.toPageId) {
      throw new Error('Backlink cannot point to its own page (self-link forbidden)');
    }
    return Object.freeze({
      fromPageId: props.fromPageId,
      toPageId: props.toPageId,
      relationName: props.relationName,
    });
  },
};

// TD1 / SF5 — Cardinality is enforced inside `Wiki.addBacklinks` via this
// pure partition. Callers receive both the kept set and a typed list of
// violations they emit as `BacklinkArityViolated` events; violations are
// NOT silently inserted into D1 (which would seed false-positive findings
// downstream in 2.D's lint pass).
export interface ArityViolation {
  readonly backlink: Backlink;
  readonly relationName: string;
  readonly cardinality: Cardinality;
  readonly reason: 'duplicate-outgoing' | 'duplicate-incoming';
}

export const partitionBacklinksByArity = (
  backlinks: ReadonlyArray<Backlink>,
  relations: ReadonlyArray<Relation>,
): { kept: Backlink[]; violations: ArityViolation[] } => {
  const cardinalityOf = new Map<string, Cardinality>(relations.map((r) => [r.name, r.cardinality]));
  const seenOutgoing = new Map<string, Set<WikiPageId>>();
  const seenIncoming = new Map<string, Set<WikiPageId>>();
  const kept: Backlink[] = [];
  const violations: ArityViolation[] = [];

  for (const bl of backlinks) {
    if (!bl.relationName) {
      kept.push(bl);
      continue;
    }
    const card = cardinalityOf.get(bl.relationName);
    if (!card) {
      kept.push(bl);
      continue;
    }
    let violated: ArityViolation['reason'] | null = null;
    if (card === 'one-to-one' || card === 'many-to-one') {
      const set = seenOutgoing.get(bl.relationName) ?? new Set<WikiPageId>();
      if (set.has(bl.fromPageId)) violated = 'duplicate-outgoing';
      seenOutgoing.set(bl.relationName, set);
    }
    if (!violated && (card === 'one-to-one' || card === 'one-to-many')) {
      const set = seenIncoming.get(bl.relationName) ?? new Set<WikiPageId>();
      if (set.has(bl.toPageId)) violated = 'duplicate-incoming';
      seenIncoming.set(bl.relationName, set);
    }

    if (violated) {
      violations.push({
        backlink: bl,
        relationName: bl.relationName,
        cardinality: card,
        reason: violated,
      });
      continue;
    }

    // Only record this edge in seen-sets once we know it's kept.
    if (card === 'one-to-one' || card === 'many-to-one') {
      seenOutgoing.get(bl.relationName)?.add(bl.fromPageId);
    }
    if (card === 'one-to-one' || card === 'one-to-many') {
      seenIncoming.get(bl.relationName)?.add(bl.toPageId);
    }
    kept.push(bl);
  }

  return { kept, violations };
};
