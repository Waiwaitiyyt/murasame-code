import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the actual Electron permission bridge with isolated IPC and window doubles.
function permissionBridge() {
  const source = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('confirmTool: async (call) => {');
  const end = source.indexOf('\n        },', start);
  const ipc = new EventEmitter();
  const target = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
  });
  const sent: { channel: string; payload: unknown }[] = [];
  const controller = new AbortController();
  const confirm = runInNewContext(`({${source.slice(start, end)}\n}}).confirmTool`, {
    ipcMain: ipc,
    appWindow: { isDestroyed: () => false, show() {}, webContents: target },
    abortController: controller,
    require: () => ({ randomUUID: () => 'request-id' }),
  });
  return { ipc, target, sent, controller, confirm };
}

test('desktop permissions only accept the requesting window and matching request', async () => {
  const { ipc, target, confirm } = permissionBridge();
  const result = confirm({ name: 'shell', input: { command: 'echo hello' } });
  ipc.emit('tool-permission-response', { sender: {} }, { id: 'request-id', answer: 'always' });
  ipc.emit('tool-permission-response', { sender: target }, { id: 'old-request', answer: 'yes' });
  assert.equal(ipc.listenerCount('tool-permission-response'), 1);
  ipc.emit('tool-permission-response', { sender: target }, { id: 'request-id', answer: 'always' });
  assert.equal(await result, 'always');
  assert.equal(ipc.listenerCount('tool-permission-response'), 0);
});

test('stopping a task denies pending desktop permissions and removes listeners', async () => {
  const { ipc, target, sent, controller, confirm } = permissionBridge();
  const result = confirm({ name: 'shell', input: {} });
  controller.abort();
  assert.equal(await result, 'no');
  assert.equal(sent.at(-1)?.channel, 'tool-permission-cancelled');
  assert.equal(ipc.listenerCount('tool-permission-response'), 0);
  assert.equal(target.listenerCount('destroyed'), 0);
});

test('closing the desktop window denies pending permissions', async () => {
  const { target, confirm } = permissionBridge();
  const result = confirm({ name: 'shell', input: {} });
  target.emit('destroyed');
  assert.equal(await result, 'no');
});
