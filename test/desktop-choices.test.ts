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

function choiceInterface() {
  class Element extends EventTarget {
    children: Element[] = [];
    textContent = '';
    returnValue = '';
    hidden = false;
    open = false;
    append(child: Element) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    contains(child: Element) { return this.children.includes(child); }
    get firstElementChild() { return this.children[0]; }
    focus() { document.activeElement = this; }
    click() { this.dispatchEvent(new Event('click')); }
    showModal() { this.open = true; }
    close(value = '') {
      this.returnValue = value;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }
  }
  const previous = new Element();
  const options = new Element();
  const dialog = new Element();
  const document = {
    activeElement: previous,
    createElement: () => new Element(),
    getElementById: (id: string) => id === 'choice-options' ? options : new Element(),
  };
  const source = readFileSync(new URL('../desktop/desktop.js', import.meta.url), 'utf8');
  const start = source.indexOf('let choiceQueue =');
  const end = source.indexOf("ipcRenderer.on('tool-permission-request'", start);
  const choose = runInNewContext(`${source.slice(start, end)}\nchoose`, { document, choiceDialog: dialog });
  const key = (name: string) => dialog.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: name }));
  return { choose, document, previous, options, dialog, key };
}

test('desktop choices focus immediately, wrap with arrows and confirm with Enter', async () => {
  const { choose, document, previous, options, key } = choiceInterface();
  const result = choose('Language', [
    { label: 'Chinese', value: 'zh' }, { label: 'English', value: 'en' },
  ]);
  await Promise.resolve();
  assert.equal(document.activeElement, options.children[0]);
  key('ArrowUp');
  assert.equal(document.activeElement, options.children[1]);
  key('ArrowDown');
  assert.equal(document.activeElement, options.children[0]);
  key('ArrowDown');
  key('Enter');
  assert.equal(await result, 'en');
  assert.equal(document.activeElement, previous);
});

test('desktop choices handle arrows from outside the options and Escape cancels', async () => {
  const { choose, document, previous, options, dialog, key } = choiceInterface();
  const result = choose('Permission', [{ label: 'Allow', value: 'yes' }]);
  await Promise.resolve();
  previous.focus();
  key('ArrowDown');
  assert.equal(document.activeElement, options.children[0]);
  key('Escape');
  assert.equal(await result, null);
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, previous);
});
