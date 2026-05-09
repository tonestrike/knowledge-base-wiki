import { describe, expect, it } from 'bun:test';
import { chatContract } from '@package/contracts/chat';
import { chatRouter } from './index.ts';

describe('chatRouter', () => {
  it('implements every procedure the contract declares', () => {
    expect(Object.keys(chatRouter).sort()).toEqual(Object.keys(chatContract).sort());
  });
});
