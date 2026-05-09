import { describe, expect, it } from 'bun:test';
import { PageType, Relation, WikiSchema } from './wiki-schema.ts';

describe('WikiSchema', () => {
  it('parses a board-governance schema', () => {
    const schema = WikiSchema.parse({
      pageTypes: [
        { name: 'Decision', description: 'A board decision recorded with rationale.' },
        { name: 'Metric', description: 'A tracked KPI or financial figure.' },
        { name: 'Person', description: 'A named individual or role.' },
      ],
      relations: [
        { name: 'DecidedAt', from: 'Decision', to: 'Person', cardinality: 'many-to-one' },
        { name: 'OwnedBy', from: 'Metric', to: 'Person', cardinality: 'many-to-one' },
      ],
    });
    expect(schema.pageTypes).toHaveLength(3);
    expect(schema.relations[0]?.name).toBe('DecidedAt');
  });

  it('rejects PageType names that are not PascalCase', () => {
    expect(() => PageType.parse({ name: 'decision', description: 'lowercase fails' })).toThrow();
  });

  it('rejects relations referencing unknown PageTypes', () => {
    expect(() =>
      WikiSchema.parse({
        pageTypes: [{ name: 'Decision', description: 'd' }],
        relations: [{ name: 'Bogus', from: 'Decision', to: 'Ghost', cardinality: 'one-to-one' }],
      }),
    ).toThrow(/relation .*Bogus.*Ghost/);
  });

  it('Relation cardinality is a closed enum', () => {
    expect(() =>
      Relation.parse({
        name: 'X',
        from: 'A',
        to: 'B',
        cardinality: 'wat',
      }),
    ).toThrow();
  });
});
