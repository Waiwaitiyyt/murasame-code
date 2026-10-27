import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clearSession, loadSession, saveSession, sessionFilePath } from '../src/session.js';

test('sessions survive reload and stay isolated by workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasame-session-'));
  try {
    const directory = join(root, 'store');
    const first = join(root, 'project-a');
    const second = join(root, 'project-b');
    const conversation = loadSession(first, directory);
    conversation.push({ role: 'user', content: 'Continue this project' });
    conversation.push({ role: 'assistant', content: 'Ready', toolCalls: [] });
    saveSession(first, conversation, directory);

    assert.notEqual(sessionFilePath(first, directory), sessionFilePath(second, directory));
    assert.deepEqual(loadSession(first, directory).slice(1), conversation.slice(1));
    assert.equal(loadSession(second, directory).length, 1);
    assert.equal(JSON.parse(readFileSync(sessionFilePath(first, directory), 'utf8')).cwd, first);

    clearSession(first, directory);
    assert.equal(loadSession(first, directory).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an interrupted tool call receives a result before conversation resumes', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasame-session-'));
  try {
    const cwd = join(root, 'project');
    const conversation = loadSession(cwd, root);
    conversation.push({ role: 'user', content: 'Inspect files' });
    conversation.push({ role: 'assistant', content: '', toolCalls: [
      { id: 'call-1', name: 'glob', input: { pattern: '*' } },
      { id: 'call-2', name: 'grep_search', input: { pattern: 'TODO' } },
    ] });
    conversation.push({ role: 'tool', toolCallId: 'call-1', name: 'glob', content: 'a.ts' });
    saveSession(cwd, conversation, root);

    const restored = loadSession(cwd, root);
    assert.equal(restored.length, conversation.length + 1);
    assert.deepEqual(restored.at(-1), {
      role: 'tool', toolCallId: 'call-2', name: 'grep_search', content: '上次会话中断，工具结果未保存。',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
