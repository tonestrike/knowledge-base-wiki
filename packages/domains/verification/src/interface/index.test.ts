import { describe, expect, it } from 'bun:test';
import { verificationContract } from '@package/contracts/verification';
import { verificationRouter } from './index.ts';

describe('verificationRouter', () => {
  it('implements every procedure the contract declares', () => {
    expect(Object.keys(verificationRouter).sort()).toEqual(
      Object.keys(verificationContract).sort(),
    );
  });
});
