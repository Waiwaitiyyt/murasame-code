import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PermissionManager } from '../src/permissions.js';

test('permission mode and always approvals survive config reload with private permissions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'murasame-config-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const { configFilePath, resolveConfig, writeConfigFile } = await import('../src/config.js');
    const permissions = new PermissionManager('auto', [], writeConfigFile);
    permissions.setMode('manual');
    permissions.accept({
      id: 'test',
      name: 'bash',
      input: { command: 'rm -rf build' },
    }, 'always');

    const loaded = resolveConfig();
    assert.equal(loaded.permissionMode, 'manual');
    assert.equal(loaded.approvedActions.length, 1);
    assert.equal(new PermissionManager(loaded.permissionMode, loaded.approvedActions).needsApproval({
      id: 'next',
      name: 'bash',
      input: { command: 'rm -rf build' },
    }), false);
    assert.equal(statSync(configFilePath()).mode & 0o777, 0o600);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
