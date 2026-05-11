/**
 * Thin OpenAI embeddings client used by the Vectorize-backed
 * `searchSources` adapter. We pick `text-embedding-3-small` for two
 * reasons: (1) it's the cheapest embedder OpenAI ships that still
 * outperforms `ada-002` on retrieval benches, and (2) its 1536-dim output
 * matches the dimensionality declared on the Cloudflare Vectorize index
 * (`tenex-sources`, see `apps/api/wrangler.toml`). Changing the model
 * here requires recreating the index.
 *
 * Not a singleton — the composition root injects it. Returns a typed
 * "no embedder" error when the API key isn't configured so the
 * VectorWikiReader can fall through to the existing token-overlap path
 * instead of hard-failing the whole chat run.
 */

export class EmbedderNotConfiguredError extends Error {
  constructor() {
    super('OPENAI_EMBEDDING_API_KEY is not set');
    this.name = 'EmbedderNotConfiguredError';
  }
}

export interface Embedder {
  /**
   * Embed up to `MAX_BATCH` strings per call. Callers that need more
   * are responsible for chunking — this adapter throws if asked to embed
   * more than one batch's worth in a single call so we don't silently
   * truncate. Returns vectors in input order.
   */
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}

const MAX_BATCH = 100;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';

export interface OpenAiEmbedderConfig {
  apiKey: string | undefined;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAiEmbeddingResponse {
  data: ReadonlyArray<{ embedding: number[]; index: number }>;
}

export const createOpenAiEmbedder = (cfg: OpenAiEmbedderConfig): Embedder => ({
  async embed(texts) {
    if (!cfg.apiKey) throw new EmbedderNotConfiguredError();
    if (texts.length === 0) return [];
    if (texts.length > MAX_BATCH) {
      throw new Error(
        `openai-embedder: batch size ${texts.length} exceeds MAX_BATCH=${MAX_BATCH}; chunk upstream`,
      );
    }
    const fetchImpl = cfg.fetchImpl ?? fetch;
    const res = await fetchImpl(cfg.endpoint ?? OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model ?? MODEL,
        input: texts,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`openai-embedder: ${res.status} ${res.statusText} — ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as OpenAiEmbeddingResponse;
    // OpenAI returns vectors in the same order as inputs, but the schema
    // ships an `index` per item; sort defensively in case that ever
    // changes.
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  },
});
