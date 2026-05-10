import type { OAuthStateStore, OAuthStateValue } from '../application/ports.ts';
import type { KVNamespaceLike } from './cloudflare-bindings.ts';

const TTL_SECONDS = 600;

const stateKey = (state: string) => `oauth_state:${state}`;

export const createKVOAuthStateStore = (kv: KVNamespaceLike): OAuthStateStore => ({
  async set(state, value) {
    await kv.put(stateKey(state), JSON.stringify(value), {
      expirationTtl: TTL_SECONDS,
    });
  },
  async consume(state) {
    const raw = await kv.get(stateKey(state));
    if (!raw) return null;
    await kv.delete(stateKey(state));
    return JSON.parse(raw) as OAuthStateValue;
  },
});
