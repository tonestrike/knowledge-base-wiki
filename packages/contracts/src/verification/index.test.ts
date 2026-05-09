import { describe, expect, it } from 'bun:test';
import { verificationContract } from './index.ts';
import {
  mockLintEventStream,
  mockLintFinding,
  mockLintRun,
  mockUnsupportedFinding,
} from './mocks.ts';

describe('verification contract', () => {
  it('exposes lint + findings procedures', () => {
    expect(Object.keys(verificationContract).sort()).toEqual([
      'applyCorrection',
      'getFinding',
      'getLintRun',
      'listFindings',
      'listLintRuns',
      'start',
      'streamLintEvents',
    ]);
  });
});

describe('verification mocks', () => {
  it('mockLintRun parses cleanly', () => {
    expect(() => mockLintRun()).not.toThrow();
  });

  it('mockLintFinding parses cleanly with a supported verdict by default', () => {
    expect(mockLintFinding().verdict).toBe('supported');
  });

  it('mockUnsupportedFinding has a Correction proposal', () => {
    const f = mockUnsupportedFinding();
    expect(f.verdict).toBe('unsupported');
    expect(f.correction?.replacementText).toBeTruthy();
  });

  it('mockLintEventStream emits Started, multiple ClaimAudited, then Finished', async () => {
    const kinds: string[] = [];
    for await (const e of mockLintEventStream()) kinds.push(e.kind);
    expect(kinds[0]).toBe('LintRunStarted');
    expect(kinds.filter((k) => k === 'ClaimAudited').length).toBeGreaterThan(1);
    expect(kinds[kinds.length - 1]).toBe('LintRunFinished');
  });
});
