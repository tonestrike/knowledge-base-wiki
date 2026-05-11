import { describe, expect, test } from 'bun:test';
import { createConsoleTracer } from './console-exporter.ts';
import { startLlmCallSpan } from './llm-call.ts';

const captureLines = () => {
  const lines: unknown[] = [];
  const tracer = createConsoleTracer({ sink: (line) => lines.push(line) });
  return { tracer, lines };
};

describe('startLlmCallSpan', () => {
  test('opens span "llm.call" with standard GenAI attributes', () => {
    const { tracer, lines } = captureLines();
    const call = startLlmCallSpan(tracer, {
      system: 'openrouter',
      model: 'anthropic/claude-opus-4-7',
      operation: 'verifier.audit',
      prompt: 'check this claim',
      systemPrompt: 'You are Verifier.',
    });
    call.recordSuccess({ inputTokens: 100, outputTokens: 50 });
    call.span.end();
    const line = lines[0] as Record<string, unknown>;
    expect(line.span).toBe('llm.call');
    const attrs = line.attributes as Record<string, unknown>;
    expect(attrs['gen_ai.system']).toBe('openrouter');
    expect(attrs['gen_ai.request.model']).toBe('anthropic/claude-opus-4-7');
    expect(attrs['gen_ai.operation.name']).toBe('verifier.audit');
    expect(attrs.provider).toBe('openrouter');
    expect(attrs.model).toBe('anthropic/claude-opus-4-7');
    expect(attrs['prompt.preview']).toBe('check this claim');
    expect(attrs['system.preview']).toBe('You are Verifier.');
  });

  test('records usage tokens, latency, and optional completion preview', () => {
    const { tracer, lines } = captureLines();
    const call = startLlmCallSpan(tracer, {
      system: 'openrouter',
      model: 'x',
      operation: 'generateObject',
    });
    call.recordSuccess({
      inputTokens: 42,
      outputTokens: 7,
      completion: '{"verdict":"supported"}',
      attempts: 2,
    });
    call.span.end();
    const attrs = (lines[0] as { attributes: Record<string, unknown> }).attributes;
    expect(attrs['gen_ai.usage.input_tokens']).toBe(42);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(7);
    expect(attrs['completion.preview']).toBe('{"verdict":"supported"}');
    expect(attrs['gen_ai.attempts']).toBe(2);
    expect(typeof attrs.latency_ms).toBe('number');
  });

  test('merges adapter-specific extra attributes on start and on success', () => {
    const { tracer, lines } = captureLines();
    const call = startLlmCallSpan(tracer, {
      system: 'openrouter',
      model: 'x',
      operation: 'researcher.loop',
      extra: { 'chat.wiki_id': 'wiki-1' },
    });
    call.recordSuccess({
      inputTokens: 0,
      outputTokens: 0,
      extra: { 'chat.visited_pages': 5 },
    });
    call.span.end();
    const attrs = (lines[0] as { attributes: Record<string, unknown> }).attributes;
    expect(attrs['chat.wiki_id']).toBe('wiki-1');
    expect(attrs['chat.visited_pages']).toBe(5);
  });

  test('omits completion.preview when caller does not supply one', () => {
    const { tracer, lines } = captureLines();
    const call = startLlmCallSpan(tracer, {
      system: 'openrouter',
      model: 'x',
      operation: 'researcher.loop',
    });
    call.recordSuccess({ inputTokens: 1, outputTokens: 1 });
    call.span.end();
    const attrs = (lines[0] as { attributes: Record<string, unknown> }).attributes;
    expect('completion.preview' in attrs).toBe(false);
    expect('gen_ai.attempts' in attrs).toBe(false);
  });

  test('truncates oversized prompt and completion previews to 500 chars + ellipsis', () => {
    const { tracer, lines } = captureLines();
    const long = 'x'.repeat(600);
    const call = startLlmCallSpan(tracer, {
      system: 'openrouter',
      model: 'x',
      operation: 'generateObject',
      prompt: long,
    });
    call.recordSuccess({ inputTokens: 0, outputTokens: 0, completion: long });
    call.span.end();
    const attrs = (lines[0] as { attributes: Record<string, unknown> }).attributes;
    expect((attrs['prompt.preview'] as string).length).toBe(501);
    expect(attrs['prompt.preview']).toMatch(/…$/);
    expect((attrs['completion.preview'] as string).length).toBe(501);
  });
});
