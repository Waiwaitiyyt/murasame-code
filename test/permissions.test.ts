import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolCall } from '../src/llm.js';
import { actionFingerprint, PermissionManager } from '../src/permissions.js';

const readCall: ToolCall = { id: 'read', name: 'read_file', input: { file_path: 'src/index.ts' } };
const riskyCall: ToolCall = { id: 'danger', name: 'bash', input: { command: 'rm -rf build' } };
const safeCall: ToolCall = { id: 'safe', name: 'bash', input: { command: 'pwd' } };

test('auto, manual, and full access apply to every tool through one policy', () => {
  const permissions = new PermissionManager();
  assert.equal(permissions.needsApproval(readCall), false);
  assert.equal(permissions.needsApproval(safeCall), false);
  assert.equal(permissions.needsApproval(riskyCall), true);

  permissions.setMode('manual');
  assert.equal(permissions.needsApproval(readCall), true);
  assert.equal(permissions.needsApproval(safeCall), true);
  assert.equal(permissions.needsApproval(riskyCall), true);

  permissions.setMode('full-access');
  assert.equal(permissions.needsApproval(readCall), false);
  assert.equal(permissions.needsApproval(riskyCall), false);
});

test('yes is temporary, no rejects, and always remembers only the exact action', () => {
  const saved: Array<Record<string, unknown>> = [];
  const permissions = new PermissionManager('manual', [], (patch) => saved.push(patch));
  assert.equal(permissions.accept(riskyCall, 'no'), false);
  assert.equal(permissions.needsApproval(riskyCall), true);
  assert.equal(permissions.accept(riskyCall, 'yes'), true);
  assert.equal(permissions.needsApproval(riskyCall), true);
  assert.equal(permissions.accept(riskyCall, 'always'), true);
  assert.equal(permissions.needsApproval(riskyCall), false);
  assert.equal(permissions.needsApproval({
    ...riskyCall,
    input: { command: 'rm -rf other' },
  }), true);
  assert.equal(permissions.rememberedCount(), 1);
  assert.deepEqual(saved.at(-1), { approvedActions: [actionFingerprint(riskyCall)] });
  assert.doesNotMatch(JSON.stringify(saved), /rm -rf/);

  permissions.clearRemembered();
  assert.equal(permissions.needsApproval(riskyCall), true);
  assert.deepEqual(saved.at(-1), { approvedActions: [] });
});

test('fingerprints ignore JSON property ordering for the same action', () => {
  const first: ToolCall = { id: 'a', name: 'edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } };
  const second: ToolCall = { id: 'b', name: 'edit', input: { new_string: 'y', old_string: 'x', file_path: 'a.ts' } };
  assert.equal(actionFingerprint(first), actionFingerprint(second));
  assert.notEqual(actionFingerprint(first, '/project/a'), actionFingerprint(first, '/project/b'));
});
