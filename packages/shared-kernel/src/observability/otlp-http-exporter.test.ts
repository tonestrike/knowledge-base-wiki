import { describe, expect, it } from 'bun:test';
import {
  buildOtlpExportRequest,
  createOtlpHttpTracer,
  langfuseOtlpConfig,
  parseOtlpHeaders,
} from './otlp-http-exporter.ts';

describe('parseOtlpHeaders', () => {
  it('returns {} for missing / empty input', () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
    expect(parseOtlpHeaders('')).toEqual({});
    expect(parseOtlpHeaders(null)).toEqual({});
  });

  it('parses a single key=value pair', () => {
    expect(parseOtlpHeaders('x-team=abc123')).toEqual({ 'x-team': 'abc123' });
  });

  it('parses multiple comma-separated pairs and trims whitespace', () => {
    expect(parseOtlpHeaders('x-team=abc, x-env = prod ,Authorization=Bearer foo')).toEqual({
      'x-team': 'abc',
      'x-env': 'prod',
      Authorization: 'Bearer foo',
    });
  });

  it('skips malformed entries without throwing', () => {
    expect(parseOtlpHeaders('=lonely,bad,still-ok=val')).toEqual({ 'still-ok': 'val' });
  });
});

describe('langfuseOtlpConfig', () => {
  it('returns null when any of host/pk/sk is missing', () => {
    expect(langfuseOtlpConfig({})).toBeNull();
    expect(langfuseOtlpConfig({ LANGFUSE_HOST: 'https://cloud.langfuse.com' })).toBeNull();
    expect(
      langfuseOtlpConfig({
        LANGFUSE_HOST: 'https://cloud.langfuse.com',
        LANGFUSE_PUBLIC_KEY: 'pk-abc',
      }),
    ).toBeNull();
  });

  it('derives endpoint at /api/public/otel and Basic-auth header', () => {
    const cfg = langfuseOtlpConfig({
      LANGFUSE_HOST: 'https://cloud.langfuse.com',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-abc',
      LANGFUSE_SECRET_KEY: 'sk-lf-xyz',
    });
    expect(cfg).not.toBeNull();
    expect(cfg?.endpoint).toBe('https://cloud.langfuse.com/api/public/otel');
    const auth = cfg?.headers.Authorization ?? '';
    expect(auth.startsWith('Basic ')).toBe(true);
    // Decode and confirm we encoded the pk:sk pair (we use btoa, base64-only).
    const token = auth.slice('Basic '.length);
    expect(atob(token)).toBe('pk-lf-abc:sk-lf-xyz');
  });

  it('strips trailing slashes from the host', () => {
    const cfg = langfuseOtlpConfig({
      LANGFUSE_HOST: 'https://lf.example.com//',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    });
    expect(cfg?.endpoint).toBe('https://lf.example.com/api/public/otel');
  });
});

describe('buildOtlpExportRequest', () => {
  it('wraps spans in a resourceSpans/scopeSpans envelope with service.name', () => {
    const env = buildOtlpExportRequest(
      [
        {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          name: 'llm.call',
          kind: 1,
          startTimeUnixNano: '1700000000000000000',
          endTimeUnixNano: '1700000001000000000',
        },
      ],
      'tenex-test',
    );
    expect(env.resourceSpans).toHaveLength(1);
    const rs = env.resourceSpans[0];
    expect(rs?.resource.attributes[0]?.key).toBe('service.name');
    expect(rs?.resource.attributes[0]?.value).toEqual({ stringValue: 'tenex-test' });
    expect(rs?.scopeSpans[0]?.spans).toHaveLength(1);
    expect(rs?.scopeSpans[0]?.spans[0]?.name).toBe('llm.call');
  });
});

describe('createOtlpHttpTracer', () => {
  it('POSTs to ${endpoint}/v1/traces with the supplied headers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (input: unknown, init?: unknown) => {
      calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const waits: Promise<unknown>[] = [];
    const tracer = createOtlpHttpTracer({
      endpoint: 'https://cloud.langfuse.com/api/public/otel/',
      headers: { Authorization: 'Basic dGVzdA==' },
      fetchImpl: fakeFetch,
      now: (() => {
        let t = 1_700_000_000_000;
        return () => {
          t += 100;
          return t;
        };
      })(),
      waitUntil: (p) => {
        waits.push(p);
      },
    });

    const span = tracer.startSpan('llm.call', {
      'gen_ai.system': 'anthropic',
      'gen_ai.request.model': 'claude-sonnet-4.6',
    });
    span.setAttribute('gen_ai.usage.input_tokens', 42);
    span.setAttribute('gen_ai.usage.output_tokens', 7);
    span.setStatus('ok');
    span.end();

    await Promise.all(waits);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://cloud.langfuse.com/api/public/otel/v1/traces');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.Authorization).toBe('Basic dGVzdA==');
    const body = JSON.parse(String(call?.init.body)) as ReturnType<typeof buildOtlpExportRequest>;
    const span0 = body.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span0?.name).toBe('llm.call');
    // intValue is encoded as a string by the OTLP JSON mapping.
    const inputTokens = span0?.attributes?.find((a) => a.key === 'gen_ai.usage.input_tokens');
    expect(inputTokens?.value).toEqual({ intValue: '42' });
    const system = span0?.attributes?.find((a) => a.key === 'gen_ai.system');
    expect(system?.value).toEqual({ stringValue: 'anthropic' });
  });

  it('records exceptions as span events and flips status to error', async () => {
    let captured: unknown = null;
    const fakeFetch = (async (_input: unknown, init?: unknown) => {
      captured = JSON.parse(String((init as RequestInit | undefined)?.body));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const waits: Promise<unknown>[] = [];
    const tracer = createOtlpHttpTracer({
      endpoint: 'https://otlp.example/api',
      fetchImpl: fakeFetch,
      waitUntil: (p) => {
        waits.push(p);
      },
    });
    const span = tracer.startSpan('llm.call');
    span.recordException(new Error('upstream 503'));
    span.end();
    await Promise.all(waits);
    const span0 = (captured as ReturnType<typeof buildOtlpExportRequest>).resourceSpans[0]
      ?.scopeSpans[0]?.spans[0];
    expect(span0?.status).toEqual({ code: 2 });
    expect(span0?.events?.[0]?.name).toBe('exception');
    const exType = span0?.events?.[0]?.attributes?.find((a) => a.key === 'exception.type');
    const exMsg = span0?.events?.[0]?.attributes?.find((a) => a.key === 'exception.message');
    expect(exType?.value).toEqual({ stringValue: 'Error' });
    expect(exMsg?.value).toEqual({ stringValue: 'upstream 503' });
  });

  it('is a no-op on a second end() call (idempotent)', async () => {
    const calls: string[] = [];
    const fakeFetch = (async () => {
      calls.push('hit');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const waits: Promise<unknown>[] = [];
    const tracer = createOtlpHttpTracer({
      endpoint: 'https://otlp.example',
      fetchImpl: fakeFetch,
      waitUntil: (p) => {
        waits.push(p);
      },
    });
    const span = tracer.startSpan('compile.run');
    span.end();
    span.end();
    await Promise.all(waits);
    expect(calls).toHaveLength(1);
  });
});
