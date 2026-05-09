import { describe, expect, it } from 'bun:test';
import { contract } from './index.ts';

describe('top-level contract', () => {
  it('exposes the four bounded contexts (plus core, kept until Slice 1.B)', () => {
    expect(Object.keys(contract).sort()).toEqual([
      'chat',
      'core',
      'ingestion',
      'verification',
      'wiki',
    ]);
  });

  it('is a typed surface (compile-time check)', () => {
    type _Static = typeof contract.wiki.startCompile;
    void (null as unknown as _Static);
  });
});
