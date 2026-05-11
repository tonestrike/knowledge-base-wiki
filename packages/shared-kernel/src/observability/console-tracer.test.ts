import { describe, expect, it } from 'bun:test';
import { type ConsoleSpanLine, createConsoleTracer } from './console-exporter.ts';
import { resolveTracer, withSpan } from './index.ts';

describe('createConsoleTracer', () => {
  it('emits one structured line per ended span with attributes intact', () => {
    const lines: ConsoleSpanLine[] = [];
    let t = 1_700_000_000_000;
    const tracer = createConsoleTracer({
      sink: (l) => lines.push(l),
      now: () => {
        t += 50;
        return t;
      },
    });
    const span = tracer.startSpan('llm.call', { 'gen_ai.system': 'anthropic' });
    span.setAttribute('model', 'claude-sonnet-4.6');
    span.setStatus('ok');
    span.end();

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.span).toBe('llm.call');
    expect(line?.status).toBe('ok');
    expect(line?.attributes).toMatchObject({
      'gen_ai.system': 'anthropic',
      model: 'claude-sonnet-4.6',
    });
    expect(line?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures recordException and flips status to error', () => {
    const lines: ConsoleSpanLine[] = [];
    const tracer = createConsoleTracer({ sink: (l) => lines.push(l) });
    const span = tracer.startSpan('llm.call');
    span.recordException(new Error('boom'));
    span.end();
    expect(lines[0]?.status).toBe('error');
    expect(lines[0]?.exception?.message).toBe('boom');
  });

  it('ignores setAttribute / setStatus after end()', () => {
    const lines: ConsoleSpanLine[] = [];
    const tracer = createConsoleTracer({ sink: (l) => lines.push(l) });
    const span = tracer.startSpan('chat.turn');
    span.end();
    span.setAttribute('after', 'end');
    span.setStatus('error');
    span.end(); // idempotent
    expect(lines).toHaveLength(1);
    expect(lines[0]?.attributes.after).toBeUndefined();
    expect(lines[0]?.status).toBe('ok');
  });
});

describe('withSpan', () => {
  it('ends the span with ok on resolve', async () => {
    const lines: ConsoleSpanLine[] = [];
    const tracer = createConsoleTracer({ sink: (l) => lines.push(l) });
    const out = await withSpan(tracer, 'lint.run', { wikiId: 'w-1' }, async (span) => {
      span.setAttribute('claims', 12);
      return 42;
    });
    expect(out).toBe(42);
    expect(lines[0]?.status).toBe('ok');
    expect(lines[0]?.attributes.claims).toBe(12);
  });

  it('records the exception and rethrows on reject', async () => {
    const lines: ConsoleSpanLine[] = [];
    const tracer = createConsoleTracer({ sink: (l) => lines.push(l) });
    await expect(
      withSpan(tracer, 'llm.call', undefined, async () => {
        throw new Error('upstream 429');
      }),
    ).rejects.toThrow('upstream 429');
    expect(lines[0]?.status).toBe('error');
    expect(lines[0]?.exception?.message).toBe('upstream 429');
  });
});

describe('resolveTracer', () => {
  it('defaults to ConsoleTracer when no env is set', () => {
    const tracer = resolveTracer({});
    // Smoke-test: calling endSpan should not throw.
    const span = tracer.startSpan('test');
    span.end();
    expect(span).toBeDefined();
  });

  it('uses an OTLP tracer when Langfuse vars are present', async () => {
    const calls: string[] = [];
    const _origFetch = globalThis.fetch;
    // Stub fetch so the tracer can flush without making a real request.
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const tracer = resolveTracer({
        LANGFUSE_HOST: 'https://cloud.langfuse.com',
        LANGFUSE_PUBLIC_KEY: 'pk-test',
        LANGFUSE_SECRET_KEY: 'sk-test',
      });
      const span = tracer.startSpan('llm.call');
      span.end();
      // Allow fire-and-forget fetch to drain.
      await new Promise((r) => setTimeout(r, 10));
      expect(calls[0]).toBe('https://cloud.langfuse.com/api/public/otel/v1/traces');
    } finally {
      globalThis.fetch = _origFetch;
    }
  });
});
