import { describe, expect, it } from 'bun:test';
import { sourceId } from '@package/contracts/shared';
import { planCompile } from './plan-compile.ts';
import type { LlmClient } from './ports.ts';
import { researchSource } from './research-source.ts';

const fake = (response: unknown): LlmClient => ({
  async generateObject() {
    return { result: response as never, inputTokens: 0, outputTokens: 0 };
  },
});

describe('planCompile', () => {
  it('produces tasks limited to known PageTypes from the WikiSchema', async () => {
    const out = await planCompile(
      {
        llm: fake({
          tasks: [
            {
              sourceId: '11111111-2222-4333-8444-000000000001',
              pageTypes: ['Decision', 'Metric', 'Ghost'],
            },
          ],
        }),
      },
      {
        schema: {
          pageTypes: [
            { name: 'Decision', description: 'd' },
            { name: 'Metric', description: 'm' },
          ],
          relations: [],
        },
        sources: [
          {
            sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
            filename: 'q3.pdf',
            contentHash: 'sha256:abc',
            text: '...',
          },
        ],
      },
    );
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]?.pageTypes).toEqual(['Decision', 'Metric']);
  });
});

describe('researchSource', () => {
  it('returns findings keyed by PageType', async () => {
    const out = await researchSource(
      {
        llm: fake({
          findings: [
            {
              pageType: 'Decision',
              title: 'Expand into EMEA in Q4',
              evidence: 'p4 of board minutes',
              spanStart: 0,
              spanEnd: 19,
            },
            {
              pageType: 'Metric',
              title: 'Q3 NRR 110%',
              evidence: 'p7 of metrics deck',
              spanStart: 0,
              spanEnd: 19,
            },
          ],
        }),
      },
      {
        source: {
          sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
          filename: 'q3.pdf',
          contentHash: 'sha256:abc',
          text: '0123456789012345678901234567890',
        },
        pageTypes: ['Decision', 'Metric'],
      },
    );
    expect(out.findings).toHaveLength(2);
    expect(new Set(out.findings.map((f) => f.pageType))).toEqual(new Set(['Decision', 'Metric']));
  });

  it('drops findings whose pageType is not in the input list', async () => {
    const out = await researchSource(
      {
        llm: fake({
          findings: [
            {
              pageType: 'Ghost',
              title: 'X',
              evidence: 'y',
              spanStart: 0,
              spanEnd: 1,
            },
          ],
        }),
      },
      {
        source: {
          sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
          filename: 'q3.pdf',
          contentHash: 'sha256:abc',
          text: 'x',
        },
        pageTypes: ['Decision'],
      },
    );
    expect(out.findings).toEqual([]);
  });
});
