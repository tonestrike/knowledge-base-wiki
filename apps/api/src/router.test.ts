import { describe, expect, it } from 'bun:test';
import app from './index.ts';

const ORIGIN = 'http://localhost';

describe('apps/api router', () => {
  it('GET / returns the placeholder text', async () => {
    const res = await app.fetch(new Request(`${ORIGIN}/`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('tenex api');
  });

  it('GET /rpc/core/health resolves to { status: "ok", timestamp }', async () => {
    const res = await app.fetch(new Request(`${ORIGIN}/rpc/core/health`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: { status: string; timestamp: string } };
    expect(body.json.status).toBe('ok');
    expect(typeof body.json.timestamp).toBe('string');
    expect(new Date(body.json.timestamp).toISOString()).toBe(body.json.timestamp);
  });

  it('POST /rpc/core/ping echoes the input message', async () => {
    const res = await app.fetch(
      new Request(`${ORIGIN}/rpc/core/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: { message: 'hello' }, meta: [] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: { echo: string; receivedAt: string } };
    expect(body.json.echo).toBe('hello');
    expect(typeof body.json.receivedAt).toBe('string');
    expect(new Date(body.json.receivedAt).toISOString()).toBe(body.json.receivedAt);
  });
});
