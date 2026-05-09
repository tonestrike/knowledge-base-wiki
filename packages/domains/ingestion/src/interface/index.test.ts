import { describe, expect, it } from 'bun:test';
import { ingestionContract } from '@package/contracts/ingestion';
import { ingestionRouter } from './index.ts';

describe('ingestionRouter', () => {
  it('implements every procedure the contract declares', () => {
    const contractKeys = Object.keys(ingestionContract).sort();
    const routerKeys = Object.keys(ingestionRouter).sort();
    expect(routerKeys).toEqual(contractKeys);
  });
});
