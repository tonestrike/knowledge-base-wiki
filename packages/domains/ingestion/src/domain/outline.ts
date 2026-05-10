import type { ByteRange } from '@package/contracts/shared';

export type OutlineKind = 'heading' | 'table' | 'figure';

// Brand on the level so callers can't pass `-1`, `0`, or `1.5`. Construct
// only via `outlineLevel()`; misuse is caught at the seam, not later.
export type OutlineLevel = number & { readonly __brand: 'OutlineLevel' };

export const outlineLevel = (n: number): OutlineLevel => {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`outline level must be a positive integer, got ${n}`);
  }
  return n as OutlineLevel;
};

export interface OutlineNode {
  readonly kind: OutlineKind;
  readonly level: OutlineLevel;
  readonly title: string;
  readonly byteRange: ByteRange;
  readonly page?: number;
}

export interface Outline {
  readonly nodes: ReadonlyArray<OutlineNode>;
}

export const Outline = {
  fromNodes(nodes: ReadonlyArray<OutlineNode>): Outline {
    const frozen = nodes.map((n) => Object.freeze({ ...n }));
    return Object.freeze({ nodes: Object.freeze(frozen) });
  },
  empty(): Outline {
    return Object.freeze({ nodes: Object.freeze([] as ReadonlyArray<OutlineNode>) });
  },
};

export const outlineDepth = (o: Outline): number =>
  o.nodes.reduce((max, n) => Math.max(max, n.level), 0);
