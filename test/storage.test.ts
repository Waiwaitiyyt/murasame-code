import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writePrivateFileAtomic } from '../src/storage.js';

test('atomic saves replace contents with private permissions and leave no temporary files', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasame-storage-'));
  try {
    const file = join(root, 'config.json');
    writeFileSync(file, 'old key', { mode: 0o644 });
    writePrivateFileAtomic(file, '新配置 🌸');
    assert.equal(readFileSync(file, 'utf8'), '新配置 🌸');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(root), ['config.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed replacement preserves the destination and cleans up its temporary file', () => {
  const root = mkdtempSync(join(tmpdir(), 'murasame-storage-'));
  try {
    const destination = join(root, 'config.json');
    mkdirSync(destination);
    writeFileSync(join(destination, 'original'), 'keep me');
    assert.throws(() => writePrivateFileAtomic(destination, 'new data'));
    assert.equal(readFileSync(join(destination, 'original'), 'utf8'), 'keep me');
    assert.deepEqual(readdirSync(root), ['config.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
