import { describe, expect, it } from 'bun:test';
import { checkHealth } from './check-health.ts';

describe('checkHealth', () => {
  it('returns ok with the clock-supplied timestamp', () => {
    const fixed = new Date('2026-05-09T12:00:00.000Z');
    const result = checkHealth({ clock: { now: () => fixed } });
    expect(result.status).toBe('ok');
    expect(result.timestamp).toEqual(fixed);
  });
});
