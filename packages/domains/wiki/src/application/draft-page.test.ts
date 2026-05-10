import { describe, expect, it } from 'bun:test';
import { contentHash, sourceId } from '@package/contracts/shared';
import { draftPage } from './draft-page.ts';
import type { LlmClient } from './ports.ts';

describe('draftPage', () => {
  it('returns a Concept-page draft with cited claims', async () => {
    const fake: LlmClient = {
      generateObject: async () => ({
        result: {
          title: 'Decision: Expand into EMEA in Q4',
          slug: 'expand-into-emea',
          body: '## Context\n\nApproved.\n\n## Decision\n\nThe board approved a $2M cap.',
          claims: [
            {
              paragraphId: 'p-2',
              claimText: 'The board approved a $2M cap.',
              citations: [
                {
                  sourceId: '11111111-2222-4333-8444-000000000001',
                  spanStart: 1240,
                  spanEnd: 1410,
                  label: 'Q3 minutes, p.4',
                },
              ],
            },
          ],
        } as never,
        inputTokens: 1,
        outputTokens: 1,
      }),
    };

    const out = await draftPage(
      { llm: fake },
      {
        pageType: 'Decision',
        findings: [
          {
            sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
            sourceFilename: 'q3-minutes.pdf',
            sourceText: '...',
            sourceContentHash: contentHash('sha256:abcdef0123456789'),
            evidence: 'The board approved a $2M cap.',
            spanStart: 1240,
            spanEnd: 1410,
            title: 'Expand into EMEA in Q4',
          },
        ],
      },
    );
    expect(out.draft.title).toContain('EMEA');
    expect(out.draft.claims).toHaveLength(1);
    expect(out.draft.claims[0]?.citations[0]?.label).toBe('Q3 minutes, p.4');
    expect(out.draft.claims[0]?.citations[0]?.sourceContentHash).toBe(
      contentHash('sha256:abcdef0123456789'),
    );
  });

  it('throws when the model cites a sourceId that was not in the findings', async () => {
    const fake: LlmClient = {
      generateObject: async () => ({
        result: {
          title: 't',
          slug: 's',
          body: 'b',
          claims: [
            {
              paragraphId: 'p-1',
              claimText: 'x',
              citations: [
                {
                  sourceId: '99999999-2222-4333-8444-000000000099',
                  spanStart: 0,
                  spanEnd: 1,
                  label: 'l',
                },
              ],
            },
          ],
        } as never,
        inputTokens: 1,
        outputTokens: 1,
      }),
    };
    await expect(
      draftPage(
        { llm: fake },
        {
          pageType: 'Decision',
          findings: [
            {
              sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
              sourceFilename: 'q3-minutes.pdf',
              sourceText: '...',
              sourceContentHash: contentHash('sha256:abc'),
              evidence: 'x',
              spanStart: 0,
              spanEnd: 1,
              title: 't',
            },
          ],
        },
      ),
    ).rejects.toThrow(/unknown sourceId/);
  });
});
