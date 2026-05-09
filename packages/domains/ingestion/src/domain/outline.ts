import type { ByteRange } from '@package/contracts/shared';

export type OutlineKind = 'heading' | 'table' | 'figure';

export interface OutlineNode {
  readonly kind: OutlineKind;
  readonly level: number;
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
