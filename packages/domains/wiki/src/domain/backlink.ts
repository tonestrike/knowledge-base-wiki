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

export const validateRelationArity = (
  backlinks: ReadonlyArray<Backlink>,
  relations: ReadonlyArray<Relation>,
): string[] => {
  const errors: string[] = [];
  const byRelation = new Map<string, Backlink[]>();
  for (const bl of backlinks) {
    if (!bl.relationName) continue;
    byRelation.set(bl.relationName, [...(byRelation.get(bl.relationName) ?? []), bl]);
  }
  const cardinalityOf = new Map<string, Cardinality>(relations.map((r) => [r.name, r.cardinality]));
  for (const [rel, bls] of byRelation) {
    const card = cardinalityOf.get(rel);
    if (!card) continue;
    if (card === 'one-to-one' || card === 'many-to-one') {
      const seen = new Set<WikiPageId>();
      for (const bl of bls) {
        if (seen.has(bl.fromPageId)) {
          errors.push(`relation "${rel}" cardinality ${card} violated by ${bl.fromPageId}`);
        }
        seen.add(bl.fromPageId);
      }
    }
    if (card === 'one-to-one' || card === 'one-to-many') {
      const seenIncoming = new Set<WikiPageId>();
      for (const bl of bls) {
        if (seenIncoming.has(bl.toPageId)) {
          errors.push(
            `relation "${rel}" cardinality ${card} violated by incoming edge to ${bl.toPageId}`,
          );
        }
        seenIncoming.add(bl.toPageId);
      }
    }
  }
  return errors;
};
