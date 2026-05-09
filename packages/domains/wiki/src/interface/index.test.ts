import { describe, expect, it } from 'bun:test';
import { wikiContract } from '@package/contracts/wiki';
import { wikiRouter } from './index.ts';

describe('wikiRouter', () => {
  it('implements every procedure the contract declares', () => {
    expect(Object.keys(wikiRouter).sort()).toEqual(Object.keys(wikiContract).sort());
  });
});
