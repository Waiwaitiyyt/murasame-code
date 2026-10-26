import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compactConversation, runTurn, trimConversation, type Conversation } from '../src/agent.js';
import type { LLMClient } from '../src/llm.js';

test('trimming history keeps complete turns without duplicating messages', () => {
  const conversation: Conversation = [{ role: 'system', content: 'system' }];
  for (let i = 0; i < 10; i++) {
    conversation.push({ role: 'user', content: `question ${i}` });
    conversation.push({ role: 'assistant', content: `answer ${i}`, toolCalls: [] });
  }
  trimConversation(conversation, 8);

  assert.deepEqual(conversation.map((message) => message.role), [
    'system', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
  ]);
  assert.deepEqual(
    conversation.filter((message) => message.role === 'user').map((message) => message.content),
    ['question 7', 'question 8', 'question 9'],
  );
});

test('trimming never splits an assistant tool call from its result', () => {
  const conversation: Conversation = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'old answer', toolCalls: [] },
    { role: 'user', content: 'new' },
    { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'bash', input: {} }] },
    { role: 'tool', toolCallId: '1', name: 'bash', content: 'result' },
    { role: 'assistant', content: 'answer', toolCalls: [] },
  ];
  trimConversation(conversation, 5);
  assert.equal(conversation[1].role, 'user');
  assert.equal((conversation[1] as { content: string }).content, 'new');
  assert.equal(conversation[3].role, 'tool');
});

test('trimming a long tool turn removes older complete turns', () => {
  const conversation: Conversation = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'old answer', toolCalls: [] },
    { role: 'user', content: 'long turn' },
  ];
  for (let i = 0; i < 10; i++) {
    conversation.push({ role: 'assistant', content: '', toolCalls: [{ id: String(i), name: 'bash', input: {} }] });
    conversation.push({ role: 'tool', toolCallId: String(i), name: 'bash', content: 'result' });
  }
  trimConversation(conversation, 8);
  assert.equal(conversation[1].role, 'user');
  assert.equal((conversation[1] as { content: string }).content, 'long turn');
  assert.equal(conversation.length, 22);
});

test('compaction replaces history only after a summary succeeds', async () => {
  const conversation: Conversation = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'Fix the parser' },
    { role: 'assistant', content: 'The parser was fixed.', toolCalls: [] },
  ];
  const client: LLMClient = {
    provider: 'openai',
    async stream(messages, tools) {
      assert.equal(messages.length, 2);
      assert.deepEqual(tools, []);
      return {
        text: 'The parser was fixed.',
        toolCalls: [],
        usage: { inputTokens: 25, outputTokens: 6 },
      };
    },
  };
  const result = await compactConversation(client, conversation, new AbortController().signal);
  assert.deepEqual(result.usage, { inputTokens: 25, outputTokens: 6 });
  assert.equal(conversation.length, 2);
  assert.match((conversation[1] as { content: string }).content, /parser was fixed/);
});

test('runTurn does not execute destructive bash without approval', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'murasame-approval-'));
  mkdirSync(join(cwd, 'victim'));
  let calls = 0;
  const client: LLMClient = {
    provider: 'openai',
    async stream() {
      calls++;
      return calls === 1
        ? { text: '', toolCalls: [{ id: 'danger', name: 'bash', input: { command: 'rm -rf victim' } }] }
        : { text: 'done', toolCalls: [] };
    },
  };
  const results: string[] = [];
  try {
    await runTurn(client, [{ role: 'system', content: 'system' }], 'clean up', {
      onToolResult: (_call, ok, result) => {
        assert.equal(ok, false);
        results.push(result);
      },
    }, new AbortController().signal, cwd);
    assert.match(results[0], /未获确认|not approved/);
    assert.equal(existsSync(join(cwd, 'victim')), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('aborting between tool calls leaves valid tool results for the next turn', async () => {
  const controller = new AbortController();
  const conversation: Conversation = [{ role: 'system', content: 'system' }];
  const client: LLMClient = {
    provider: 'openai',
    async stream() {
      return {
        text: 'running tools',
        toolCalls: [
          { id: 'first', name: 'bash', input: { command: 'pwd' } },
          { id: 'second', name: 'bash', input: { command: 'pwd' } },
        ],
      };
    },
  };
  await assert.rejects(runTurn(client, conversation, 'inspect', {
    onActionTitle: () => controller.abort(),
  }, controller.signal, process.cwd()), { name: 'AbortError' });
  assert.deepEqual(conversation.slice(-2).map((message) =>
    message.role === 'tool' ? message.toolCallId : ''), ['first', 'second']);
});
