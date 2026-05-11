import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EmbedderNotConfiguredError, createOpenAiEmbedder } from './openai-embedder.ts';

const ORIGINAL_FETCH = globalThis.fetch;

interface FetchCall {
  url: string;
  body: unknown;
  authHeader: string | null;
}

const stubFetch = (handler: (call: FetchCall) => Response): void => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof URL ? input.toString() : String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(init.body as string) : null;
    return handler({ url, body, authHeader: headers.get('authorization') });
    // biome-ignore lint/suspicious/noExplicitAny: stubbing the global fetch
  }) as any;
};

describe('createOpenAiEmbedder', () => {
  let calls: FetchCall[];
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('throws EmbedderNotConfiguredError when the api key is missing', async () => {
    const embedder = createOpenAiEmbedder({ apiKey: undefined });
    await expect(embedder.embed(['hello'])).rejects.toBeInstanceOf(EmbedderNotConfiguredError);
  });

  it('returns [] for an empty input without hitting the API', async () => {
    stubFetch(() => {
      throw new Error('should not be called');
    });
    const embedder = createOpenAiEmbedder({ apiKey: 'sk-test' });
    const out = await embedder.embed([]);
    expect(out).toEqual([]);
  });

  it('POSTs the batch with model + bearer auth and returns vectors in input order', async () => {
    stubFetch((call) => {
      calls.push(call);
      return new Response(
        JSON.stringify({
          data: [
            { embedding: [0.2, 0.2], index: 1 },
            { embedding: [0.1, 0.1], index: 0 },
          ],
        }),
        { status: 200 },
      );
    });
    const embedder = createOpenAiEmbedder({ apiKey: 'sk-test' });
    const out = await embedder.embed(['first', 'second']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.authHeader).toBe('Bearer sk-test');
    expect((calls[0]?.body as { model: string }).model).toBe('text-embedding-3-small');
    expect((calls[0]?.body as { input: string[] }).input).toEqual(['first', 'second']);
    expect(out).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
  });

  it('refuses batches larger than the OpenAI per-call limit', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    const embedder = createOpenAiEmbedder({ apiKey: 'sk-test' });
    const huge = Array.from({ length: 101 }, (_, i) => String(i));
    await expect(embedder.embed(huge)).rejects.toThrow(/MAX_BATCH/);
  });

  it('throws a descriptive error on a non-2xx response', async () => {
    stubFetch(() => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }));
    const embedder = createOpenAiEmbedder({ apiKey: 'sk-test' });
    await expect(embedder.embed(['hi'])).rejects.toThrow(/429/);
  });
});
