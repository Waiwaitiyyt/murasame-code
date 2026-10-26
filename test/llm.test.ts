import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, toOpenAIMessage } from '../src/llm.js';

test('text-only assistant history omits tool_calls on the next request', () => {
  const message = toOpenAIMessage({
    role: 'assistant',
    content: 'First answer',
    toolCalls: [],
  });

  assert.deepEqual(message, { role: 'assistant', content: 'First answer' });
  assert.equal('tool_calls' in JSON.parse(JSON.stringify(message)), false);
});

test('assistant tool calls are preserved in OpenAI history', () => {
  const message = toOpenAIMessage({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call_1', name: 'bash', input: { command: 'pwd' } }],
  });

  assert.deepEqual(message, {
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'bash', arguments: '{"command":"pwd"}' },
    }],
  });
});

test('Claude retries without prompt caching when a provider rejects cache_control', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const client = createClient({
    provider: 'claude',
    apiKey: 'test-key',
    model: 'claude-test',
    baseUrl: 'https://example.invalid',
    language: 'zh',
  });
  const rawClient = (client as unknown as { client: { fetch: typeof fetch } }).client;
  rawClient.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'cache_control is unsupported' },
    }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(client.stream(
    [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }],
    [],
    {},
    new AbortController().signal,
  ));
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].system, [{
    type: 'text',
    text: 'system',
    cache_control: { type: 'ephemeral' },
  }]);
  assert.equal(bodies[1].system, 'system');
});

test('OpenAI summary requests omit an empty tools array', async () => {
  let body: Record<string, unknown> | undefined;
  const client = createClient({
    provider: 'openai',
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'https://example.invalid/v1',
    language: 'zh',
  });
  const rawClient = (client as unknown as { client: { fetch: typeof fetch } }).client;
  rawClient.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      error: { message: 'test rejection', type: 'invalid_request_error' },
    }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(client.stream(
    [{ role: 'system', content: 'Summarize' }, { role: 'user', content: 'history' }],
    [],
    {},
    new AbortController().signal,
  ));
  assert.equal(body?.tools, undefined);
});
