import { describe, expect, it } from 'bun:test';
import { wikiPageId } from '@package/contracts/shared';
import { Backlink, partitionBacklinksByArity } from './backlink.ts';

describe('Backlink', () => {
  it('refuses self-links', () => {
    const id = wikiPageId('dddddddd-1111-4222-8333-444444444444');
    expect(() =>
      Backlink.create({ fromPageId: id, toPageId: id, relationName: 'DecidedAt' }),
    ).toThrow(/self/);
  });

  it('one-to-one drops a second outgoing edge from the same source and reports a violation', () => {
    const a = wikiPageId('dddddddd-1111-4222-8333-444444444401');
    const b = wikiPageId('dddddddd-1111-4222-8333-444444444402');
    const c = wikiPageId('dddddddd-1111-4222-8333-444444444403');
    const links = [
      Backlink.create({ fromPageId: a, toPageId: b, relationName: 'OwnedBy' }),
      Backlink.create({ fromPageId: a, toPageId: c, relationName: 'OwnedBy' }),
    ];
    const { kept, violations } = partitionBacklinksByArity(links, [
      { name: 'OwnedBy', from: 'X', to: 'Y', cardinality: 'one-to-one' },
    ]);
    expect(kept).toHaveLength(1);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toBe('duplicate-outgoing');
  });

  it('many-to-many tolerates duplicates by (from, to)', () => {
    const a = wikiPageId('dddddddd-1111-4222-8333-444444444401');
    const b = wikiPageId('dddddddd-1111-4222-8333-444444444402');
    const links = [
      Backlink.create({ fromPageId: a, toPageId: b, relationName: 'RaisedIn' }),
      Backlink.create({ fromPageId: a, toPageId: b, relationName: 'RaisedIn' }),
    ];
    const { kept, violations } = partitionBacklinksByArity(links, [
      { name: 'RaisedIn', from: 'A', to: 'B', cardinality: 'many-to-many' },
    ]);
    expect(kept).toHaveLength(2);
    expect(violations).toEqual([]);
  });
});
