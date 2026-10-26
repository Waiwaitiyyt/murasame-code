const { ipcRenderer } = require('electron');

let running = false;
let currentAnswer = null;
let currentDirectory = '';
let openFile = null;
let savedContents = '';
let terminalRunning = false;
const conversation = document.getElementById('conversation');
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
const status = document.getElementById('agent-status');
const editor = document.getElementById('file-editor');
const fileList = document.getElementById('file-list');
const terminalOutput = document.getElementById('terminal-output');

function appendBubble(role, content) {
  conversation.querySelector('.hint')?.remove();
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;
  conversation.append(bubble);
  conversation.scrollTop = conversation.scrollHeight;
  return bubble;
}

function addToolEvent(content) {
  const card = document.createElement('div');
  card.className = 'tool-event';
  card.textContent = content;
  conversation.append(card);
  conversation.scrollTop = conversation.scrollHeight;
}

function renderSession(messages) {
  conversation.replaceChildren();
  for (const message of messages) {
    if (message.type === 'tool') {
      addToolEvent(`${message.name}\n${message.content}`);
    } else if (message.type === 'action') {
      if (message.content) appendBubble('assistant', message.content);
      for (const tool of message.tools) addToolEvent(`调用 ${tool.name}\n${JSON.stringify(tool.input, null, 2)}`);
    } else if (message.content) {
      appendBubble(message.role === 'user' ? 'user' : 'assistant', message.content);
    }
  }
  if (!messages.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = '试试：';
    for (const text of ['阅读项目结构并总结', '检查当前项目中的问题']) {
      const button = document.createElement('button');
      button.className = 'suggestion';
      button.textContent = text;
      button.addEventListener('click', () => { prompt.value = text; prompt.focus(); });
      hint.append(button);
    }
    conversation.append(hint);
  }
}

async function refreshWorkspace() {
  const folder = await ipcRenderer.invoke('get-workspace');
  const workspace = document.getElementById('workspace');
  workspace.textContent = folder;
  workspace.title = folder;
  document.getElementById('terminal-cwd').textContent = folder;
  await refreshSession();
  await refreshFiles();
}

async function refreshSession() {
  try { renderSession(await ipcRenderer.invoke('get-session')); }
  catch (error) { status.textContent = error.message; }
}

function setPage(pageId) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === pageId));
  document.querySelectorAll('.nav-pages .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.page === pageId));
  if (pageId === 'files') refreshFiles();
}

document.querySelectorAll('.nav-pages .tab').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
document.getElementById('workspace').addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('choose-workspace');
  if (folder) { currentDirectory = ''; openFile = null; editor.value = ''; await refreshWorkspace(); }
});
document.getElementById('pet-mode').addEventListener('click', () => ipcRenderer.send('minimize-to-pet'));
document.getElementById('tray-mode').addEventListener('click', () => ipcRenderer.send('minimize-to-tray'));
document.getElementById('new-session').addEventListener('click', async () => {
  await ipcRenderer.invoke('new-session');
  currentAnswer = null;
  await refreshSession();
  setPage('agent');
  prompt.focus();
});

document.querySelectorAll('.suggestion').forEach((button) => button.addEventListener('click', () => { prompt.value = button.textContent; prompt.focus(); }));
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('prompt-form').requestSubmit(); }
});
document.getElementById('prompt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (running || !prompt.value.trim()) return;
  running = true;
  send.disabled = true;
  document.getElementById('stop-agent').hidden = false;
  status.textContent = '丛雨正在处理…';
  currentAnswer = null;
  const task = prompt.value.trim();
  prompt.value = '';
  appendBubble('user', task);
  currentAnswer = appendBubble('assistant', '丛雨正在思考…');
  try {
    const result = await ipcRenderer.invoke('run-murasame', task);
    if (result.error) {
      if (currentAnswer.textContent === '丛雨正在思考…') currentAnswer.textContent = result.error;
      currentAnswer.classList.add('error');
    }
  } catch (error) {
    currentAnswer.textContent = error.message;
    currentAnswer.classList.add('error');
  }
});
document.getElementById('stop-agent').addEventListener('click', () => ipcRenderer.send('stop-agent'));
ipcRenderer.on('agent-event', (_event, data) => {
  if (data.type === 'text') {
    if (currentAnswer?.textContent === '丛雨正在思考…') currentAnswer.textContent = '';
    if (currentAnswer) currentAnswer.textContent += data.delta;
    conversation.scrollTop = conversation.scrollHeight;
  } else if (data.type === 'action') {
    addToolEvent(`行动：${data.title}`);
    currentAnswer = appendBubble('assistant', '丛雨正在思考…');
  } else if (data.type === 'tool') {
    addToolEvent(`${data.ok ? '✓' : '✕'} ${data.name}${data.target ? ` · ${data.target}` : ''}\n${data.result}`);
  } else if (data.type === 'done') {
    running = false;
    send.disabled = false;
    document.getElementById('stop-agent').hidden = true;
    status.textContent = '由 murasame-code 提供 · 请检查 AI 生成的修改';
    refreshFiles();
  }
});

async function refreshFiles() {
  const breadcrumb = document.getElementById('file-breadcrumb');
  breadcrumb.replaceChildren();
  const crumb = document.createElement('button');
  crumb.textContent = currentDirectory ? `项目 / ${currentDirectory}` : '项目根目录';
  crumb.addEventListener('click', () => { currentDirectory = ''; refreshFiles(); });
  breadcrumb.append(crumb);
  fileList.replaceChildren();
  try {
    const entries = await ipcRenderer.invoke('list-workspace-files', currentDirectory);
    if (currentDirectory) {
      const up = document.createElement('button');
      up.className = 'file-entry directory';
      up.textContent = '↰  ..';
      up.addEventListener('click', () => { currentDirectory = currentDirectory.split('/').slice(0, -1).join('/'); refreshFiles(); });
      fileList.append(up);
    }
    for (const entry of entries) {
      const button = document.createElement('button');
      button.className = `file-entry ${entry.directory ? 'directory' : ''}`;
      button.textContent = `${entry.directory ? '▸' : '·'}  ${entry.name}`;
      button.title = entry.path;
      button.addEventListener('click', () => {
        if (entry.directory) { currentDirectory = entry.path; refreshFiles(); }
        else loadFile(entry.path);
      });
      fileList.append(button);
    }
    if (!entries.length) fileList.innerHTML = '<div class="file-empty">此目录为空</div>';
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'file-empty';
    message.textContent = error.message;
    fileList.append(message);
  }
}

async function loadFile(filePath) {
  try {
    const file = await ipcRenderer.invoke('read-workspace-file', filePath);
    openFile = file.path;
    savedContents = file.content;
    editor.value = file.content;
    document.getElementById('editor-path').textContent = file.path;
    document.getElementById('save-file').disabled = false;
    document.getElementById('save-status').textContent = '';
  } catch (error) { window.alert(error.message); }
}
editor.addEventListener('input', () => {
  document.getElementById('save-status').textContent = editor.value === savedContents ? '' : '未保存';
});
document.getElementById('save-file').addEventListener('click', async () => {
  if (!openFile) return;
  try {
    await ipcRenderer.invoke('save-workspace-file', openFile, editor.value);
    savedContents = editor.value;
    document.getElementById('save-status').textContent = '已保存';
    setTimeout(() => { if (document.getElementById('save-status').textContent === '已保存') document.getElementById('save-status').textContent = ''; }, 1600);
  } catch (error) { window.alert(error.message); }
});
document.getElementById('refresh-files').addEventListener('click', refreshFiles);

function appendTerminal(text) {
  terminalOutput.textContent += text;
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}
ipcRenderer.on('terminal-output', (_event, text) => appendTerminal(text));
document.getElementById('terminal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('terminal-command');
  const command = input.value.trim();
  if (!command || terminalRunning) return;
  terminalRunning = true;
  document.getElementById('run-command').disabled = true;
  document.getElementById('stop-command').hidden = false;
  appendTerminal(`\n$ ${command}\n`);
  input.value = '';
  const result = await ipcRenderer.invoke('run-terminal', command);
  if (result.error) appendTerminal(`${result.error}\n`);
  terminalRunning = false;
  document.getElementById('run-command').disabled = false;
  document.getElementById('stop-command').hidden = true;
});
document.getElementById('stop-command').addEventListener('click', () => ipcRenderer.send('stop-terminal'));
document.getElementById('clear-terminal').addEventListener('click', () => { terminalOutput.textContent = ''; });

refreshWorkspace();
