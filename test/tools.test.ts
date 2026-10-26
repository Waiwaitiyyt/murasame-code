import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executeTool, requiresCommandApproval } from '../src/tools.js';

test('read_file caps requested lines and edit preserves replacement dollars', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'murasame-tools-'));
  try {
    writeFileSync(join(cwd, 'large.txt'), Array.from({ length: 2200 }, (_, i) => `line ${i}`).join('\n'));
    const read = await executeTool('read_file', { file_path: 'large.txt', limit: 10000, offset: -5 }, cwd);
    assert.match(read, /2000 │ line 1999/);
    assert.doesNotMatch(read, /2001 │ line 2000/);

    writeFileSync(join(cwd, 'edit.txt'), 'costs 1 dollars');
    const edit = await executeTool('edit', {
      file_path: 'edit.txt',
      old_string: '1',
      new_string: '$&',
    }, cwd);
    assert.equal(readFileSync(join(cwd, 'edit.txt'), 'utf8'), 'costs $& dollars');
    assert.match(edit, /- costs 1 dollars\n\+ costs \$& dollars/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('default search skips dependencies but finds project files', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'murasame-search-'));
  try {
    mkdirSync(join(cwd, 'src'));
    mkdirSync(join(cwd, 'node_modules'));
    writeFileSync(join(cwd, 'src', 'main.ts'), 'needle\nneedle');
    writeFileSync(join(cwd, 'node_modules', 'package.js'), 'needle');
    const result = await executeTool('grep_search', { pattern: 'needle' }, cwd);
    assert.match(result, /src\/main\.ts:1: needle/);
    assert.match(result, /src\/main\.ts:2: needle/);
    assert.doesNotMatch(result, /node_modules/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('aborting bash stops a child command promptly', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const result = executeTool('bash', { command: 'sleep 30' }, process.cwd(), controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(result, { name: 'AbortError' });
  assert.ok(Date.now() - started < 3000);
});

test('destructive shell commands require approval', () => {
  assert.equal(requiresCommandApproval('rm -rf dist'), true);
  assert.equal(requiresCommandApproval('git reset --hard HEAD'), true);
  assert.equal(requiresCommandApproval('git clean -fd'), true);
  assert.equal(requiresCommandApproval('pwd'), false);
});
