import assert from 'node:assert/strict';
import test from 'node:test';
import { toOpenAIMessage } from '../src/llm.js';

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
