const { ipcRenderer } = require('electron');

let running = false;
let currentAnswer = null;
let currentDirectory = '';
let openFile = null;
let savedContents = '';
let terminalRunning = false;
let detailLevel = 'all';
const conversation = document.getElementById('conversation');
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
const status = document.getElementById('agent-status');
const editor = document.getElementById('file-editor');
const fileList = document.getElementById('file-list');
const terminalOutput = document.getElementById('terminal-output');
const appMenu = document.getElementById('app-menu');
const fileMenu = document.getElementById('file-menu');
const configDialog = document.getElementById('agent-config-dialog');
const choiceDialog = document.getElementById('choice-dialog');
const providerDefaults = {
  claude: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
};

function appendBubble(role, content) {
  conversation.querySelector('.hint')?.remove();
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  if (role === 'assistant') {
    bubble.dataset.rawMarkdown = content;
    window.renderMurasameMarkdown(bubble, content);
  } else {
    bubble.textContent = content;
  }
  conversation.append(bubble);
  conversation.scrollTop = conversation.scrollHeight;
  return bubble;
}

function updateAssistantMarkdown(bubble, content) {
  if (!bubble) return;
  bubble.dataset.rawMarkdown = content;
  window.renderMurasameMarkdown(bubble, content);
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
    hint.append(document.createTextNode('试试：'));
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

function closeMenu() {
  appMenu.hidden = true;
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
}

function showNotice(message, isError = false) {
  const bubble = appendBubble('assistant', message);
  if (isError) bubble.classList.add('error');
  return bubble;
}

function choose(title, choices) {
  const heading = document.getElementById('choice-title');
  const options = document.getElementById('choice-options');
  heading.textContent = title;
  options.replaceChildren();
  return new Promise((resolve) => {
    const onClose = () => {
      choiceDialog.removeEventListener('close', onClose);
      resolve(choiceDialog.returnValue || null);
    };
    choiceDialog.addEventListener('close', onClose);
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      const label = document.createElement('strong');
      label.textContent = choice.label;
      button.append(label);
      if (choice.description) {
        const description = document.createElement('span');
        description.textContent = choice.description;
        button.append(description);
      }
      button.addEventListener('click', () => choiceDialog.close(choice.value));
      options.append(button);
    }
    choiceDialog.showModal();
  });
}

async function openConfigDialog() {
  try {
    const current = await ipcRenderer.invoke('get-agent-config');
    document.getElementById('config-provider').value = current.provider;
    document.getElementById('config-base-url').value = current.baseUrl;
    document.getElementById('config-model').value = current.model;
    const key = document.getElementById('config-api-key');
    key.value = '';
    key.placeholder = current.apiKeyConfigured ? '留空则保留已保存的 Key' : '请输入 API Key';
    configDialog.showModal();
  } catch (error) { showNotice(error.message, true); }
}

async function updateAgentConfig(patch) {
  try {
    const updated = await ipcRenderer.invoke('save-agent-config', patch);
    showNotice(`模型设置已保存：${updated.provider} / ${updated.model}`);
    return updated;
  } catch (error) {
    showNotice(error.message, true);
    throw error;
  }
}

async function runCommand(command) {
  closeMenu();
  const [name] = command.trim().split(/\s+/);
  if (name === '/help') {
    showNotice([
      '可用命令：',
      '/help       显示命令帮助',
      '/clear      清空当前会话与 Token 统计',
      '/config     配置模型接口、Base URL、API Key',
      '/lang       切换丛雨回复语言',
      '/detail     设置工具输出详细程度',
      '/model      查看或切换模型',
      '/cost       查看当前会话 Token 用量',
      '/compact    压缩较早的对话记录',
      '/permission 设置工具权限模式；可清除已记住的授权',
      '/exit       退出应用',
    ].join('\n'));
    return;
  }
  if (name === '/clear') {
    if (running) { showNotice('任务运行期间不能清空会话。', true); return; }
    await ipcRenderer.invoke('clear-session');
    renderSession([]);
    showNotice('当前会话已清空。');
    return;
  }
  if (name === '/config') { await openConfigDialog(); return; }
  if (name === '/lang') {
    const language = await choose('选择回复语言', [
      { label: '简体中文', description: 'zh', value: 'zh' },
      { label: 'English', description: 'en', value: 'en' },
      { label: '日本語', description: 'ja', value: 'ja' },
    ]);
    if (!language) return;
    await ipcRenderer.invoke('set-agent-language', language);
    showNotice(`丛雨的回复语言已切换为 ${language}。`);
    return;
  }
  if (name === '/detail') {
    const level = await choose('工具输出详细程度', [
      { label: '关闭', description: '只显示工具名称', value: 'off' },
      { label: '命令', description: '显示工具名称与目标', value: 'command' },
      { label: '简要', description: '显示结果前三行', value: 'threeLines' },
      { label: '完整', description: '显示完整工具输出', value: 'all' },
    ]);
    if (!level) return;
    detailLevel = level;
    await ipcRenderer.invoke('set-desktop-preference', 'detailLevel', level);
    showNotice(`工具输出详细程度已设为：${level}。`);
    return;
  }
  if (name === '/model') {
    const current = await ipcRenderer.invoke('get-agent-config');
    const action = await choose(`当前模型：${current.model}`, [
      { label: '切换模型名称…', value: 'change' },
      { label: '打开完整模型设置', value: 'config' },
    ]);
    if (action === 'config') { await openConfigDialog(); return; }
    if (action !== 'change') return;
    const model = window.prompt('输入模型名称', current.model);
    if (!model?.trim()) return;
    await updateAgentConfig({ ...current, model: model.trim(), apiKey: '' });
    return;
  }
  if (name === '/cost') {
    const usage = await ipcRenderer.invoke('get-usage');
    showNotice(usage.input + usage.output > 0
      ? `当前会话 Token 用量\n输入：${usage.input.toLocaleString()}\n输出：${usage.output.toLocaleString()}\n合计：${(usage.input + usage.output).toLocaleString()}`
      : '当前会话还没有 Token 用量记录。');
    return;
  }
  if (name === '/compact') {
    if (running) { showNotice('请等当前任务完成后再压缩会话。', true); return; }
    status.textContent = '正在压缩会话…';
    const result = await ipcRenderer.invoke('compact-session');
    if (result.error) showNotice(result.error, true);
    else { await refreshSession(); showNotice('较早的对话已压缩为摘要。'); }
    status.textContent = '由 murasame-code 提供 · 请检查 AI 生成的修改';
    return;
  }
  if (name === '/permission') {
    const mode = await choose('工具权限模式', [
      { label: '自动', description: '危险操作会请求确认', value: 'auto' },
      { label: '手动', description: '每次工具调用都请求确认', value: 'manual' },
      { label: '完全访问', description: '不弹出工具确认', value: 'full-access' },
      { label: '清除已记住的授权', value: 'reset' },
    ]);
    if (!mode) return;
    if (mode === 'reset') {
      await ipcRenderer.invoke('reset-permissions');
      showNotice('已清除记住的工具授权。');
    } else {
      await ipcRenderer.invoke('set-permission-mode', mode);
      showNotice(`工具权限模式已切换为：${mode}。`);
    }
    return;
  }
  if (name === '/exit') ipcRenderer.send('exit-application');
}

async function selectBackground(name) {
  try {
    const url = await ipcRenderer.invoke('set-background', name);
    applyBackground(url);
    updateBackgroundSelection(name ? { kind: 'builtin', name } : null);
    closeMenu();
  } catch (error) { showNotice(error.message, true); }
}

function applyBackground(url) {
  document.documentElement.style.setProperty('--workspace-wallpaper', url ? `url("${url.replace(/"/g, '%22')}")` : 'none');
}

function updateBackgroundSelection(background) {
  document.querySelectorAll('.background-option').forEach((button) => {
    button.classList.toggle('selected', background?.kind === 'builtin' && background.name === button.dataset.background);
  });
  document.getElementById('upload-background').classList.toggle('selected', background?.kind === 'uploaded');
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.getElementById('theme-label').textContent = next === 'dark' ? '深色' : '浅色';
}

async function initializeAppearance() {
  const preferences = await ipcRenderer.invoke('get-desktop-preferences');
  detailLevel = preferences.detailLevel || 'all';
  applyTheme(preferences.theme);
  const [background, backgroundUrl] = await Promise.all([
    Promise.resolve(preferences.background), ipcRenderer.invoke('get-background-url'),
  ]);
  applyBackground(backgroundUrl);
  updateBackgroundSelection(background);
}

document.getElementById('menu-toggle').addEventListener('click', () => {
  appMenu.hidden = !appMenu.hidden;
  document.getElementById('menu-toggle').setAttribute('aria-expanded', String(!appMenu.hidden));
});
function closeFileMenu() {
  fileMenu.hidden = true;
  document.getElementById('file-menu-toggle').setAttribute('aria-expanded', 'false');
}
document.getElementById('file-menu-toggle').addEventListener('click', () => {
  closeMenu();
  fileMenu.hidden = !fileMenu.hidden;
  document.getElementById('file-menu-toggle').setAttribute('aria-expanded', String(!fileMenu.hidden));
});
async function chooseWorkspace() {
  closeFileMenu();
  const folder = await ipcRenderer.invoke('choose-workspace');
  if (folder) { currentDirectory = ''; openFile = null; editor.value = ''; await refreshWorkspace(); }
}
document.getElementById('open-folder').addEventListener('click', () => chooseWorkspace().catch((error) => showNotice(error.message, true)));
appMenu.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', (event) => {
  if (!appMenu.hidden && !appMenu.contains(event.target) && !document.getElementById('menu-toggle').contains(event.target)) closeMenu();
  if (!fileMenu.hidden && !document.querySelector('.file-menu-wrap').contains(event.target)) closeFileMenu();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeMenu(); closeFileMenu(); } });
document.getElementById('theme-toggle').addEventListener('click', async () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  await ipcRenderer.invoke('set-desktop-preference', 'theme', theme);
});
document.querySelectorAll('.background-option').forEach((button) => button.addEventListener('click', () => selectBackground(button.dataset.background)));
document.getElementById('clear-background').addEventListener('click', () => selectBackground(null));
document.getElementById('upload-background').addEventListener('click', async () => {
  try {
    const url = await ipcRenderer.invoke('upload-background');
    if (!url) return;
    applyBackground(url);
    updateBackgroundSelection({ kind: 'uploaded' });
    closeMenu();
  } catch (error) { showNotice(error.message, true); }
});
document.querySelectorAll('.command-row').forEach((button) => button.addEventListener('click', () => {
  runCommand(button.dataset.command).catch((error) => showNotice(error.message, true));
}));
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.getElementById('config-provider').addEventListener('change', (event) => {
  const defaults = providerDefaults[event.target.value];
  document.getElementById('config-base-url').value = defaults.baseUrl;
  document.getElementById('config-model').value = defaults.model;
});
document.getElementById('agent-config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const patch = {
    provider: document.getElementById('config-provider').value,
    baseUrl: document.getElementById('config-base-url').value.trim(),
    model: document.getElementById('config-model').value.trim(),
    apiKey: document.getElementById('config-api-key').value,
  };
  try {
    const result = await ipcRenderer.invoke('save-agent-config', patch);
    document.getElementById('config-api-key').value = '';
    configDialog.close();
    showNotice(`模型设置已保存：${result.provider} / ${result.model}`);
  } catch (error) { showNotice(error.message, true); }
});

document.querySelectorAll('.nav-pages .tab').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
document.getElementById('workspace').addEventListener('click', () => chooseWorkspace().catch((error) => showNotice(error.message, true)));
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
      if (currentAnswer.dataset.rawMarkdown === '丛雨正在思考…') updateAssistantMarkdown(currentAnswer, result.error);
      currentAnswer.classList.add('error');
    }
  } catch (error) {
    updateAssistantMarkdown(currentAnswer, error.message);
    currentAnswer.classList.add('error');
  }
});
document.getElementById('stop-agent').addEventListener('click', () => ipcRenderer.send('stop-agent'));
ipcRenderer.on('agent-event', (_event, data) => {
  if (data.type === 'text') {
    if (currentAnswer?.dataset.rawMarkdown === '丛雨正在思考…') updateAssistantMarkdown(currentAnswer, '');
    if (currentAnswer) updateAssistantMarkdown(currentAnswer, `${currentAnswer.dataset.rawMarkdown ?? ''}${data.delta}`);
    conversation.scrollTop = conversation.scrollHeight;
  } else if (data.type === 'action') {
    addToolEvent(`行动：${data.title}`);
    currentAnswer = appendBubble('assistant', '丛雨正在思考…');
  } else if (data.type === 'tool') {
    if (detailLevel !== 'off') {
      const summary = `${data.ok ? '✓' : '✕'} ${data.name}${data.target ? ` · ${data.target}` : ''}`;
      const result = detailLevel === 'all' ? data.result : detailLevel === 'threeLines' ? data.result.split('\n').slice(0, 3).join('\n') : '';
      addToolEvent(result ? `${summary}\n${result}` : summary);
    }
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

initializeAppearance();
refreshWorkspace();
