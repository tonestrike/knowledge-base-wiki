import { describe, expect, it } from 'bun:test';
import { sourceId } from '@package/contracts/shared';
import { inferSchema } from './infer-schema.ts';
import type { LlmClient } from './ports.ts';

const fakeLlm = (response: unknown): LlmClient => ({
  async generateObject() {
    return { result: response as never, inputTokens: 100, outputTokens: 50 };
  },
});

describe('inferSchema', () => {
  it('returns the parsed WikiSchema and the model reason', async () => {
    const out = await inferSchema(
      {
        llm: fakeLlm({
          pageTypes: [
            { name: 'Decision', description: 'A board decision.' },
            { name: 'Metric', description: 'A KPI.' },
          ],
          relations: [
            {
              name: 'OwnedBy',
              from: 'Metric',
              to: 'Decision',
              cardinality: 'many-to-one',
            },
          ],
          reason: 'This folder is about board governance.',
        }),
      },
      {
        sources: [
          {
            sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
            filename: 'q3.pdf',
            contentHash: 'sha256:abc',
            text: 'minutes...',
          },
        ],
      },
    );
    expect(out.schema.pageTypes).toHaveLength(2);
    expect(out.reason).toContain('board governance');
  });

  it('rejects schemas where a Relation references an unknown PageType', async () => {
    await expect(
      inferSchema(
        {
          llm: fakeLlm({
            pageTypes: [{ name: 'Decision', description: 'd' }],
            relations: [
              {
                name: 'XGhost',
                from: 'Decision',
                to: 'Ghost',
                cardinality: 'one-to-one',
              },
            ],
            reason: 'r',
          }),
        },
        {
          sources: [
            {
              sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
              filename: 'q3.pdf',
              contentHash: 'sha256:abc',
              text: '',
            },
          ],
        },
      ),
    ).rejects.toThrow(/Ghost|unknown/);
  });
});
