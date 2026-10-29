const { ipcRenderer } = require('electron');

let running = false;
let currentAnswer = null;
let currentDirectory = '';
let openFile = null;
let savedContents = '';
let terminalRunning = false;
let detailLevel = 'all';
let uiLanguage = 'zh';
let fileRefreshToken = 0;
let sessionState = { activeId: 'default', sessions: [] };
let terminalHistory = [];
let terminalHistoryIndex = 0;
let workspaceEntries = [];
let agentStopRequested = false;
let imageFit = true;
let imageZoom = 1;
let officeDocument = null;
let officeHash = null;
let officeDirty = false;
let docxEditorInstance = null;
let docxReady = false;
let docxRevision = 0;
let docxMountId = 0;
let codeOpacity = 0.82;
const originalUiText = new WeakMap();
const originalUiAttributes = new WeakMap();
const t = (key) => window.workbenchTranslate(uiLanguage, key);
function translateWorkbench() {
  document.documentElement.lang = { zh: 'zh-CN', en: 'en', ja: 'ja' }[uiLanguage];
  document.title = t('丛雨code工作台');
  const staticRoots = ['.topbar', '#app-menu', '#background-menu', '.workbench-nav', '.welcome', '.composer', '#change-review', '.file-sidebar', '.editor-panel > .panel-heading', '#file-editor', '#office-preview', '.terminal-heading', '#terminal-form', '.app-dialog'];
  for (const selector of staticRoots) {
    document.querySelectorAll(selector).forEach((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('#editor-path, #save-status, #agent-status, #theme-label, #markdown-toggle, #slash-menu, #workspace-path')) continue;
        if (!originalUiText.has(node)) originalUiText.set(node, node.textContent);
        const original = originalUiText.get(node);
        const trimmed = original.trim();
        if (trimmed) node.textContent = original.replace(trimmed, t(trimmed));
      }
      [root, ...root.querySelectorAll('*')].forEach((element) => {
        if (element.id === 'workspace') return;
        if (!originalUiAttributes.has(element)) originalUiAttributes.set(element, { title: element.getAttribute('title'), placeholder: element.getAttribute('placeholder'), alt: element.getAttribute('alt'), 'aria-label': element.getAttribute('aria-label') });
        for (const [name, value] of Object.entries(originalUiAttributes.get(element))) if (value) element.setAttribute(name, t(value));
      });
    });
  }
  const hint = conversation.querySelector('.hint');
  if (hint) {
    hint.firstChild.textContent = t('试试：');
    hint.querySelectorAll('.suggestion').forEach((button, index) => { button.textContent = t(['阅读项目结构并总结', '检查当前项目中的问题'][index]); });
  }
  if (!terminalOutput.dataset.used) terminalOutput.textContent = t('在当前工作目录执行命令。命令由你主动提交。');
  applyTheme(document.documentElement.dataset.theme);
  setMarkdownPreview(!markdownPreview.hidden);
  if (!openFile) document.getElementById('editor-path').textContent = t('选择文件以查看');
  if (!running) status.textContent = t('由 murasame-code 提供 · 请检查 AI 生成的修改');
  if (isEditorDirty()) document.getElementById('save-status').textContent = t('未保存');
  document.getElementById('ui-language').value = uiLanguage;
  syncNavAccessibility();
  updateSlashMenu();
}
function syncNavAccessibility() {
  const labels = { agent: '对话', files: '文件', terminal: '终端' };
  document.querySelectorAll('.nav-pages .tab').forEach((button) => {
    const label = t(labels[button.dataset.page]);
    button.setAttribute('aria-label', label);
    button.title = label;
  });
  const settingsButton = document.getElementById('studio-settings');
  settingsButton.setAttribute('aria-label', t('工作台设置'));
  settingsButton.title = t('工作台设置');
  document.getElementById('workspace').setAttribute('aria-label', `${t('工作目录')}: ${document.getElementById('workspace-path').textContent}`);
}
const conversation = document.getElementById('conversation');
const prompt = document.getElementById('prompt');
const slashMenu = document.getElementById('slash-menu');
const slashCommands = [...document.querySelectorAll('.command-row')].map((button) => ({ name: button.dataset.command, description: button.querySelector('span').textContent }));
let selectedSlashCommand = 0;
const send = document.getElementById('send');
const status = document.getElementById('agent-status');
const editor = document.getElementById('file-editor');
const codeEditorShell = document.getElementById('code-editor-shell');
const codeHighlight = document.getElementById('code-highlight');
const markdownToggle = document.getElementById('markdown-toggle');
const markdownPreview = document.getElementById('markdown-preview');
const fileList = document.getElementById('file-list');
const terminalOutput = document.getElementById('terminal-output');
const appMenu = document.getElementById('app-menu');
const configDialog = document.getElementById('agent-config-dialog');
const choiceDialog = document.getElementById('choice-dialog');
const providerDefaults = {
  claude: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
};
function isEditorDirty() { return officeDocument ? officeDirty : editor.value !== savedContents; }
function destroyDocxEditor() {
  docxMountId++;
  docxReady = false;
  docxEditorInstance?.destroy();
  docxEditorInstance = null;
  document.getElementById('docx-editor').replaceChildren();
}

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
      for (const tool of message.tools) addToolEvent(`${t('调用')} ${tool.name}\n${JSON.stringify(tool.input, null, 2)}`);
    } else if (message.content) {
      appendBubble(message.role === 'user' ? 'user' : 'assistant', message.content);
    }
  }
  if (!messages.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.append(document.createTextNode(t('试试：')));
    for (const text of ['阅读项目结构并总结', '检查当前项目中的问题']) {
      const button = document.createElement('button');
      button.className = 'suggestion';
      button.textContent = t(text);
      button.addEventListener('click', () => { prompt.value = button.textContent; prompt.focus(); });
      hint.append(button);
    }
    conversation.append(hint);
  }
}

async function refreshWorkspace() {
  const folder = await ipcRenderer.invoke('get-workspace');
  const workspace = document.getElementById('workspace');
  document.getElementById('workspace-path').textContent = folder;
  workspace.title = folder;
  syncNavAccessibility();
  document.getElementById('terminal-cwd').textContent = folder;
  document.getElementById('terminal-cwd').title = folder;
  await refreshSession();
  await refreshFiles();
}

async function refreshSession() {
  try {
    const data = await ipcRenderer.invoke('get-session');
    renderSessionCards(data);
    renderSession(data.messages);
  }
  catch (error) { status.textContent = error.message; }
}
async function refreshSessionIndex() {
  const data = await ipcRenderer.invoke('get-session-index');
  renderSessionCards(data);
}
function renderSessionCards(data) {
  sessionState = { activeId: data.activeId, sessions: data.sessions };
  const list = document.getElementById('session-list');
  list.replaceChildren();
  for (const session of data.sessions) {
    const card = document.createElement('div');
    card.className = `session-card${session.id === data.activeId ? ' active' : ''}`;
    const select = document.createElement('button');
    select.type = 'button'; select.className = 'session-card-select'; select.dataset.sessionId = session.id;
    select.textContent = session.name; select.title = session.name;
    select.setAttribute('aria-current', String(session.id === data.activeId));
    const rename = document.createElement('button');
    rename.type = 'button'; rename.className = 'session-card-action'; rename.dataset.sessionAction = 'rename'; rename.dataset.sessionId = session.id;
    rename.textContent = '···'; rename.title = t('重命名'); rename.setAttribute('aria-label', `${t('重命名')}: ${session.name}`);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'session-card-action danger-action'; remove.dataset.sessionAction = 'delete'; remove.dataset.sessionId = session.id;
    remove.textContent = '×'; remove.title = t('删除'); remove.setAttribute('aria-label', `${t('删除')}: ${session.name}`);
    remove.disabled = data.sessions.length < 2;
    card.append(select, rename, remove); list.append(card);
  }
}

function setPage(pageId) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === pageId));
  document.querySelectorAll('.nav-pages .tab').forEach((tab) => {
    const active = tab.dataset.page === pageId;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  if (pageId === 'files') refreshFiles();
}

function closeMenu(returnFocus = false) {
  if (appMenu.hidden) return;
  appMenu.hidden = true;
  document.getElementById('studio-settings').setAttribute('aria-expanded', 'false');
  if (returnFocus) document.getElementById('studio-settings').focus();
}
function closeBackgroundMenu(returnFocus = false) {
  const menu = document.getElementById('background-menu');
  if (menu.hidden) return;
  menu.hidden = true;
  document.getElementById('background-toggle').setAttribute('aria-expanded', 'false');
  if (returnFocus) document.getElementById('background-toggle').focus();
}

function openMenu() {
  appMenu.hidden = false;
  document.getElementById('studio-settings').setAttribute('aria-expanded', 'true');
  document.getElementById('theme-toggle').focus();
}

function showNotice(message, isError = false) {
  const bubble = appendBubble('assistant', t(message));
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
    key.placeholder = t(current.apiKeyConfigured ? '留空则保留已保存的 Key' : '请输入 API Key');
    configDialog.showModal();
  } catch (error) { showNotice(error.message, true); }
}

async function updateAgentConfig(patch) {
  try {
    const updated = await ipcRenderer.invoke('save-agent-config', patch);
    showNotice(`${t('模型设置已保存：')}${updated.provider} / ${updated.model}`);
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
    ].map(t).join('\n'));
    return;
  }
  if (name === '/clear') {
    if (running) { showNotice(t('任务运行期间不能清空会话。'), true); return; }
    await ipcRenderer.invoke('clear-session');
    renderSession([]);
    showNotice(t('当前会话已清空。'));
    return;
  }
  if (name === '/config') { await openConfigDialog(); return; }
  if (name === '/lang') {
    const language = await choose(t('选择回复语言'), [
      { label: '简体中文', description: 'zh', value: 'zh' },
      { label: 'English', description: 'en', value: 'en' },
      { label: '日本語', description: 'ja', value: 'ja' },
    ]);
    if (!language) return;
    await ipcRenderer.invoke('set-agent-language', language);
    showNotice(`${t('丛雨的回复语言已切换为 ')}${language}。`);
    return;
  }
  if (name === '/detail') {
    const level = await choose(t('工具输出详细程度'), [
      { label: t('关闭'), description: t('只显示工具名称'), value: 'off' },
      { label: t('命令'), description: t('显示工具名称与目标'), value: 'command' },
      { label: t('简要'), description: t('显示结果前三行'), value: 'threeLines' },
      { label: t('完整'), description: t('显示完整工具输出'), value: 'all' },
    ]);
    if (!level) return;
    detailLevel = level;
    await ipcRenderer.invoke('set-desktop-preference', 'detailLevel', level);
    showNotice(`${t('工具输出详细程度已设为：')}${level}。`);
    return;
  }
  if (name === '/model') {
    const current = await ipcRenderer.invoke('get-agent-config');
    const action = await choose(`${t('当前模型：')}${current.model}`, [
      { label: t('切换模型名称…'), value: 'change' },
      { label: t('打开完整模型设置'), value: 'config' },
    ]);
    if (action === 'config') { await openConfigDialog(); return; }
    if (action !== 'change') return;
    const model = window.prompt(t('输入模型名称'), current.model);
    if (!model?.trim()) return;
    await updateAgentConfig({ ...current, model: model.trim(), apiKey: '' });
    return;
  }
  if (name === '/cost') {
    const usage = await ipcRenderer.invoke('get-usage');
    showNotice(usage.input + usage.output > 0
      ? `${t('当前会话 Token 用量')}\n${t('输入：')}${usage.input.toLocaleString()}\n${t('输出：')}${usage.output.toLocaleString()}\n${t('合计：')}${(usage.input + usage.output).toLocaleString()}`
      : t('当前会话还没有 Token 用量记录。'));
    return;
  }
  if (name === '/compact') {
    if (running) { showNotice(t('请等当前任务完成后再压缩会话。'), true); return; }
    status.textContent = t('正在压缩会话…');
    const result = await ipcRenderer.invoke('compact-session');
    if (result.error) showNotice(result.error, true);
    else { await refreshSession(); showNotice(t('较早的对话已压缩为摘要。')); }
    status.textContent = t('由 murasame-code 提供 · 请检查 AI 生成的修改');
    return;
  }
  if (name === '/permission') {
    const mode = await choose(t('工具权限模式'), [
      { label: t('自动'), description: t('危险操作会请求确认'), value: 'auto' },
      { label: t('手动'), description: t('每次工具调用都请求确认'), value: 'manual' },
      { label: t('完全访问'), description: t('不弹出工具确认'), value: 'full-access' },
      { label: t('清除已记住的授权'), value: 'reset' },
    ]);
    if (!mode) return;
    if (mode === 'reset') {
      await ipcRenderer.invoke('reset-permissions');
      showNotice(t('已清除记住的工具授权。'));
    } else {
      await ipcRenderer.invoke('set-permission-mode', mode);
      showNotice(`${t('工具权限模式已切换为：')}${mode}。`);
    }
    return;
  }
  if (name === '/exit') ipcRenderer.send('exit-application');
  else if (!slashCommands.some((entry) => entry.name === name)) showNotice(`${t('未知命令：')}${name}${t('。输入 /help 查看可用命令。')}`, true);
}

function hideSlashMenu() {
  slashMenu.hidden = true;
  prompt.setAttribute('aria-expanded', 'false');
}

function updateSlashMenu() {
  const value = prompt.value.trim();
  if (!value.startsWith('/') || /\s/.test(value)) { hideSlashMenu(); return; }
  const matches = slashCommands.filter((entry) => entry.name.startsWith(value.toLowerCase()));
  slashMenu.replaceChildren();
  if (!matches.length) { hideSlashMenu(); return; }
  selectedSlashCommand = Math.min(selectedSlashCommand, matches.length - 1);
  matches.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slash-option';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === selectedSlashCommand));
    const code = document.createElement('code');
    code.textContent = entry.name;
    const description = document.createElement('span');
    description.textContent = t(entry.description);
    button.append(code, description);
    button.addEventListener('click', () => executeSlashCommand(entry.name));
    slashMenu.append(button);
  });
  slashMenu.hidden = false;
  prompt.setAttribute('aria-expanded', 'true');
}

function executeSlashCommand(command) {
  prompt.value = '';
  hideSlashMenu();
  runCommand(command).catch((error) => showNotice(error.message, true));
  prompt.focus();
}

async function selectBackground(name) {
  try {
    const url = await ipcRenderer.invoke('set-background', name);
    applyBackground(url);
    updateBackgroundSelection(name ? { kind: 'builtin', name } : null);
    closeBackgroundMenu();
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
  document.getElementById('theme-label').textContent = t(next === 'dark' ? '深色' : '浅色');
}

async function initializeAppearance() {
  const preferences = await ipcRenderer.invoke('get-desktop-preferences');
  uiLanguage = preferences.uiLanguage || 'zh';
  translateWorkbench();
  detailLevel = preferences.detailLevel || 'all';
  codeOpacity = Number.isFinite(preferences.codeOpacity) ? preferences.codeOpacity : 0.82;
  updateCodeOpacityControl();
  applyTheme(preferences.theme);
  const [background, backgroundUrl] = await Promise.all([
    Promise.resolve(preferences.background), ipcRenderer.invoke('get-background-url'),
  ]);
  applyBackground(backgroundUrl);
  updateBackgroundSelection(background);
  document.getElementById('welcome-avatar').src = await ipcRenderer.invoke('get-avatar-url');
}

document.getElementById('ui-language').addEventListener('change', async (event) => {
  uiLanguage = event.target.value;
  await ipcRenderer.invoke('set-desktop-preference', 'uiLanguage', uiLanguage);
  translateWorkbench();
});
function updateCodeOpacityControl() {
  document.documentElement.style.setProperty('--code-editor-opacity', String(codeOpacity));
  const slider = document.getElementById('code-opacity');
  if (slider) slider.value = String(Math.round(codeOpacity * 100));
  const label = document.getElementById('code-opacity-value');
  if (label) label.textContent = `${Math.round(codeOpacity * 100)}%`;
}
document.getElementById('code-opacity').addEventListener('input', (event) => {
  codeOpacity = Number(event.target.value) / 100;
  updateCodeOpacityControl();
});
document.getElementById('code-opacity').addEventListener('change', () => ipcRenderer.invoke('set-desktop-preference', 'codeOpacity', codeOpacity));
async function chooseWorkspace() {
  const folder = await ipcRenderer.invoke('choose-workspace');
  if (folder) {
    if (!await protectUnsavedFile()) return;
    await ipcRenderer.invoke('set-workspace', folder);
    currentDirectory = '';
    openFile = null;
    savedContents = '';
    editor.value = '';
    destroyDocxEditor();
    officeDocument = null; officeHash = null; officeDirty = false;
    document.getElementById('editor-path').textContent = t('选择文件以查看');
    document.getElementById('editor-path').removeAttribute('title');
    document.getElementById('save-file').disabled = true;
    document.getElementById('save-status').textContent = '';
    document.getElementById('image-preview').hidden = true;
    document.getElementById('office-preview').hidden = true;
    document.getElementById('pdf-preview').hidden = true;
    document.getElementById('pdf-preview').src = 'about:blank';
    setMarkdownPreview(false);
    markdownToggle.hidden = true;
    updateCodeHighlight('', '');
    for (const id of ['image-dimensions', 'image-zoom-out', 'image-zoom-label', 'image-fit', 'image-zoom-in']) document.getElementById(id).hidden = true;
    updateFileSelection();
    await refreshWorkspace();
  }
}
async function protectUnsavedFile() {
  if (!isEditorDirty() || !openFile) return true;
  const action = await choose(t('文件有未保存的修改'), [
    { label: t('保存并继续'), value: 'save' },
    { label: t('放弃修改'), value: 'discard' },
    { label: t('取消'), value: 'cancel' },
  ]);
  if (action === 'discard') return true;
  if (action !== 'save') return false;
  return saveOpenFile();
}
async function saveOpenFile() {
  if (!openFile) return true;
  try {
    if (officeDocument) {
      if (!officeDirty) return true;
      const savingDocument = officeDocument;
      const savingRevision = docxRevision;
      const payload = savingDocument.kind === 'docx' ? { kind: 'docx', data: new Uint8Array(await (await docxEditorInstance.export({ exportType: ['docx'], triggerDownload: false })).arrayBuffer()) } : savingDocument;
      const result = await ipcRenderer.invoke('save-workspace-office', openFile, payload, officeHash);
      officeHash = result.hash;
      officeDirty = savingDocument.kind === 'docx' && docxRevision !== savingRevision;
      document.getElementById('save-status').textContent = t(officeDirty ? '未保存' : '已保存');
      return true;
    }
    await ipcRenderer.invoke('save-workspace-file', openFile, editor.value, savedContents);
    savedContents = editor.value;
    document.getElementById('save-status').textContent = t('已保存');
    return true;
  } catch (error) { showNotice(error.message, true); return false; }
}
ipcRenderer.on('workbench-menu-action', (_event, action) => {
  if (action === 'open-folder') chooseWorkspace().catch((error) => showNotice(error.message, true));
  else if (action === 'open-settings') openMenu();
  else if (action.startsWith('command:')) runCommand(action.slice(8)).catch((error) => showNotice(error.message, true));
});
appMenu.addEventListener('click', (event) => event.stopPropagation());
document.getElementById('studio-settings').addEventListener('click', () => {
  if (appMenu.hidden) openMenu();
  else closeMenu(true);
});
document.addEventListener('click', (event) => {
  if (!appMenu.hidden && !appMenu.contains(event.target) && !document.getElementById('studio-settings').contains(event.target)) closeMenu();
  const backgroundMenu = document.getElementById('background-menu');
  if (!backgroundMenu.hidden && !backgroundMenu.contains(event.target) && !document.getElementById('background-toggle').contains(event.target)) closeBackgroundMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!appMenu.hidden) { event.preventDefault(); closeMenu(true); }
  if (!document.getElementById('background-menu').hidden) { event.preventDefault(); closeBackgroundMenu(true); }
});
document.getElementById('background-menu').addEventListener('click', (event) => event.stopPropagation());
document.getElementById('background-toggle').addEventListener('click', () => {
  const menu = document.getElementById('background-menu');
  if (menu.hidden) {
    closeMenu(); menu.hidden = false; document.getElementById('background-toggle').setAttribute('aria-expanded', 'true');
    document.getElementById('code-opacity').focus();
  } else closeBackgroundMenu(true);
});
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
    closeBackgroundMenu();
  } catch (error) { showNotice(error.message, true); }
});
document.getElementById('upload-avatar').addEventListener('click', async () => {
  try {
    const url = await ipcRenderer.invoke('upload-avatar');
    if (url) { document.getElementById('welcome-avatar').src = url; closeMenu(); }
  } catch (error) { showNotice(error.message, true); }
});
document.getElementById('reset-avatar').addEventListener('click', async () => {
  document.getElementById('welcome-avatar').src = await ipcRenderer.invoke('reset-avatar');
  closeMenu();
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
    showNotice(`${t('模型设置已保存：')}${result.provider} / ${result.model}`);
  } catch (error) { showNotice(error.message, true); }
});

document.querySelectorAll('.nav-pages .tab').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && ['1', '2', '3'].includes(event.key)) {
    event.preventDefault(); setPage(['agent', 'files', 'terminal'][Number(event.key) - 1]);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); setPage('files'); const search = document.getElementById('file-search'); search.focus(); search.select();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault(); prompt.focus();
  }
});
document.getElementById('workspace').addEventListener('click', () => chooseWorkspace().catch((error) => showNotice(error.message, true)));
document.getElementById('pet-mode').addEventListener('click', () => ipcRenderer.send('minimize-to-pet'));
document.getElementById('tray-mode').addEventListener('click', () => ipcRenderer.send('minimize-to-tray'));
document.getElementById('new-session').addEventListener('click', async () => {
  try {
    await ipcRenderer.invoke('new-session');
    currentAnswer = null;
    await refreshSession();
    setPage('agent');
    prompt.focus();
  } catch (error) { showNotice(error.message, true); }
});
document.getElementById('session-list').addEventListener('click', async (event) => {
  const action = event.target.closest('[data-session-action]');
  const select = event.target.closest('.session-card-select');
  const id = action?.dataset.sessionId || select?.dataset.sessionId;
  if (!id) return;
  try {
    if (action?.dataset.sessionAction === 'rename') {
      const active = sessionState.sessions.find((item) => item.id === id);
      const name = window.prompt(t('输入会话名称'), active?.name || '');
      if (name === null) return;
      await ipcRenderer.invoke('rename-session', id, name);
      await refreshSessionIndex(); return;
    }
    if (action?.dataset.sessionAction === 'delete') {
      const item = sessionState.sessions.find((entry) => entry.id === id);
      if (!window.confirm(`${t('删除当前会话及其记录？')}\n${item?.name || ''}`)) return;
      await ipcRenderer.invoke('delete-session', id);
      if (id === sessionState.activeId) { currentAnswer = null; await refreshSession(); }
      else await refreshSessionIndex();
      return;
    }
    if (select && id !== sessionState.activeId) {
      if (!await protectUnsavedFile()) return;
      await ipcRenderer.invoke('select-session', id); currentAnswer = null; await refreshSession();
    }
  } catch (error) { showNotice(error.message, true); }
});

document.querySelectorAll('.suggestion').forEach((button) => button.addEventListener('click', () => { prompt.value = button.textContent; prompt.focus(); }));
prompt.addEventListener('input', () => { selectedSlashCommand = 0; updateSlashMenu(); });
prompt.addEventListener('keydown', (event) => {
  if (!slashMenu.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    selectedSlashCommand = (selectedSlashCommand + (event.key === 'ArrowDown' ? 1 : -1) + slashMenu.childElementCount) % slashMenu.childElementCount;
    updateSlashMenu();
    slashMenu.children[selectedSlashCommand]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Escape' && !slashMenu.hidden) { event.preventDefault(); hideSlashMenu(); return; }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !slashMenu.hidden) {
    event.preventDefault();
    executeSlashCommand(slashMenu.children[selectedSlashCommand].querySelector('code').textContent);
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('prompt-form').requestSubmit(); }
});
document.getElementById('prompt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!prompt.value.trim()) return;
  if (prompt.value.trim().startsWith('/')) { executeSlashCommand(prompt.value.trim()); return; }
  if (running) return;
  running = true;
  agentStopRequested = false;
  send.disabled = true;
  document.getElementById('stop-agent').hidden = false;
  status.textContent = t('丛雨正在处理…');
  currentAnswer = null;
  const task = prompt.value.trim();
  prompt.value = '';
  appendBubble('user', task);
  currentAnswer = appendBubble('assistant', t('丛雨正在思考…'));
  try {
    const result = await ipcRenderer.invoke('run-murasame', task);
    if (result.error) {
      if (currentAnswer.dataset.rawMarkdown === t('丛雨正在思考…')) updateAssistantMarkdown(currentAnswer, t(result.error));
      currentAnswer.classList.add('error');
    }
  } catch (error) {
    updateAssistantMarkdown(currentAnswer, t(error.message));
    currentAnswer.classList.add('error');
  }
});
document.getElementById('stop-agent').addEventListener('click', () => { agentStopRequested = true; status.textContent = t('正在停止…'); ipcRenderer.send('stop-agent'); });
ipcRenderer.on('agent-event', (_event, data) => {
  if (data.type === 'text') {
    if (currentAnswer?.dataset.rawMarkdown === t('丛雨正在思考…')) updateAssistantMarkdown(currentAnswer, '');
    if (currentAnswer) updateAssistantMarkdown(currentAnswer, `${currentAnswer.dataset.rawMarkdown ?? ''}${data.delta}`);
    conversation.scrollTop = conversation.scrollHeight;
  } else if (data.type === 'action') {
    status.textContent = `${t('执行中：')}${data.title}`;
    addToolEvent(`${t('行动：')}${data.title}`);
    currentAnswer = appendBubble('assistant', t('丛雨正在思考…'));
  } else if (data.type === 'tool') {
    status.textContent = `${t('执行工具：')}${data.name}${data.target ? ` · ${data.target}` : ''}`;
    if (detailLevel !== 'off') {
      const summary = `${data.ok ? '✓' : '✕'} ${data.name}${data.target ? ` · ${data.target}` : ''}`;
      const result = detailLevel === 'all' ? data.result : detailLevel === 'threeLines' ? data.result.split('\n').slice(0, 3).join('\n') : '';
      addToolEvent(result ? `${summary}\n${result}` : summary);
    }
  } else if (data.type === 'done') {
    running = false;
    send.disabled = false;
    document.getElementById('stop-agent').hidden = true;
    status.textContent = data.error ? `${t('任务失败：')}${t(data.error)}` : t('由 murasame-code 提供 · 请检查 AI 生成的修改');
    refreshFiles();
    refreshChanges();
    if (agentStopRequested) status.textContent = t('任务已停止。');
    refreshSessionIndex();
  }
});

async function refreshFiles() {
  const refreshToken = ++fileRefreshToken;
  const breadcrumb = document.getElementById('file-breadcrumb');
  breadcrumb.replaceChildren();
  breadcrumb.hidden = !currentDirectory;
  if (currentDirectory) {
    const crumb = document.createElement('button');
    crumb.textContent = `${t('项目')} / ${currentDirectory}`;
    crumb.addEventListener('click', () => { currentDirectory = ''; refreshFiles(); });
    breadcrumb.append(crumb);
  }
  fileList.replaceChildren();
  try {
    const entries = await ipcRenderer.invoke('list-workspace-files', currentDirectory);
    if (refreshToken !== fileRefreshToken) return;
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
      button.dataset.path = entry.path;
      button.dataset.search = entry.name.toLocaleLowerCase();
      button.textContent = `${entry.directory ? '▸' : '·'}  ${entry.name}`;
      button.title = entry.path;
      button.addEventListener('click', () => {
        if (entry.directory) { currentDirectory = entry.path; refreshFiles(); }
        else loadFile(entry.path);
      });
      fileList.append(button);
    }
    updateFileSelection();
    if (!entries.length) fileList.innerHTML = `<div class="file-empty">${t('此目录为空')}</div>`;
  } catch (error) {
    if (refreshToken !== fileRefreshToken) return;
    const message = document.createElement('div');
    message.className = 'file-empty';
    message.textContent = error.message;
    fileList.append(message);
  }
}

function updateFileSelection() {
  fileList.querySelectorAll('.file-entry[data-path]').forEach((button) => {
    const selected = Boolean(openFile && button.dataset.path === openFile && !button.classList.contains('directory'));
    button.classList.toggle('selected', selected);
    if (selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
}

function setOfficeDirty() {
  officeDirty = true;
  document.getElementById('save-status').textContent = t('未保存');
}
function spreadsheetColumnName(index) {
  let name = ''; let value = index + 1;
  while (value) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); }
  return name;
}
function renderSpreadsheet() {
  const documentData = officeDocument;
  const sheetData = documentData?.sheets.find((sheet) => sheet.name === document.getElementById('sheet-select').value) || documentData?.sheets[0];
  if (!sheetData) return;
  const rows = sheetData.rows;
  const visibleRows = Math.min(150, Math.max(rows.length, rows.length ? 1 : 20));
  const columnCount = Math.max(5, Math.min(40, rows.reduce((max, row) => Math.max(max, row.length), 0)));
  const table = document.getElementById('spreadsheet-table');
  table.replaceChildren();
  const head = document.createElement('thead'); const headings = document.createElement('tr');
  const corner = document.createElement('th'); corner.className = 'row-number'; corner.textContent = ''; headings.append(corner);
  for (let column = 0; column < columnCount; column++) { const th = document.createElement('th'); th.textContent = spreadsheetColumnName(column); headings.append(th); }
  head.append(headings); table.append(head);
  const body = document.createElement('tbody');
  for (let rowIndex = 0; rowIndex < visibleRows; rowIndex++) {
    const tr = document.createElement('tr'); const rowNumber = document.createElement('th'); rowNumber.className = 'row-number'; rowNumber.textContent = String(rowIndex + 1); tr.append(rowNumber);
    for (let column = 0; column < columnCount; column++) {
      const td = document.createElement('td'); const input = document.createElement('input');
      input.className = 'spreadsheet-cell'; input.value = String(rows[rowIndex]?.[column] ?? ''); input.dataset.row = String(rowIndex); input.dataset.column = String(column);
      input.addEventListener('input', () => {
        while (rows.length <= rowIndex) rows.push([]);
        rows[rowIndex][column] = input.value; setOfficeDirty();
      });
      td.append(input); tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  const limited = sheetData.truncated || rows.length > visibleRows || rows.some((row) => row.length > columnCount);
  document.getElementById('spreadsheet-note').textContent = limited ? t('表格显示前 150 行和 40 列；其余单元格会保留。') : '';
  document.getElementById('add-row').disabled = Boolean(sheetData.rowTruncated);
  document.getElementById('add-column').disabled = Boolean(sheetData.columnTruncated);
}
function renderOfficeFile(file) {
  destroyDocxEditor();
  officeDocument = file; officeHash = file.hash; officeDirty = false;
  codeEditorShell.hidden = true;
  document.querySelector('.editor-panel').classList.remove('code-theme');
  markdownPreview.hidden = true; markdownToggle.hidden = true;
  document.getElementById('image-preview').hidden = true;
  document.getElementById('pdf-preview').hidden = true; document.getElementById('pdf-preview').src = 'about:blank';
  for (const id of ['image-dimensions', 'image-zoom-out', 'image-zoom-label', 'image-fit', 'image-zoom-in']) document.getElementById(id).hidden = true;
  const officePreview = document.getElementById('office-preview'); officePreview.hidden = false;
  const spreadsheetView = document.getElementById('spreadsheet-view'); const docxView = document.getElementById('docx-view');
  spreadsheetView.hidden = file.kind !== 'spreadsheet'; docxView.hidden = file.kind !== 'docx';
  if (file.kind === 'spreadsheet') {
    const select = document.getElementById('sheet-select'); select.replaceChildren(...file.sheets.map((sheet) => { const option = document.createElement('option'); option.value = sheet.name; option.textContent = sheet.name; return option; }));
    select.value = file.sheets[0]?.name || '';
    renderSpreadsheet();
  } else {
    docxRevision = 0;
    const mountId = docxMountId;
    document.getElementById('save-file').disabled = true;
    document.getElementById('save-status').textContent = t('正在打开文档…');
    const { SuperDoc } = require('superdoc');
    const docx = new Blob([file.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    docxEditorInstance = new SuperDoc({
      selector: '#docx-editor', document: docx, contained: true, telemetry: { enabled: false },
      onReady: () => { if (mountId !== docxMountId) return; docxReady = true; document.getElementById('save-file').disabled = false; document.getElementById('save-status').textContent = ''; },
      onEditorUpdate: () => { if (mountId === docxMountId && docxReady) { docxRevision++; setOfficeDirty(); } },
      onContentError: ({ error }) => { if (mountId !== docxMountId) return; showNotice(error?.message || t('无法打开 DOCX 文档。'), true); document.getElementById('save-status').textContent = t('打开失败'); },
      onException: ({ error }) => { if (mountId !== docxMountId) return; showNotice(error?.message || t('DOCX 编辑器出错。'), true); if (!docxReady) document.getElementById('save-status').textContent = t('打开失败'); },
    });
  }
  if (file.kind === 'spreadsheet') { document.getElementById('save-file').disabled = false; document.getElementById('save-status').textContent = ''; }
}

document.getElementById('sheet-select').addEventListener('change', renderSpreadsheet);
document.getElementById('add-row').addEventListener('click', () => {
  const sheet = officeDocument?.sheets.find((item) => item.name === document.getElementById('sheet-select').value);
  if (!sheet) return;
  sheet.rows.push(Array(Math.max(5, sheet.rows.reduce((max, row) => Math.max(max, row.length), 0))).fill(''));
  setOfficeDirty(); renderSpreadsheet();
});
document.getElementById('add-column').addEventListener('click', () => {
  const sheet = officeDocument?.sheets.find((item) => item.name === document.getElementById('sheet-select').value);
  if (!sheet) return;
  if (!sheet.rows.length) sheet.rows.push([]);
  sheet.rows.forEach((row) => row.push(''));
  setOfficeDirty(); renderSpreadsheet();
});
async function loadFile(filePath) {
  if (!await protectUnsavedFile()) return;
  try {
    const isImage = /\.(?:png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(filePath);
    if (isImage) {
      const file = await ipcRenderer.invoke('read-workspace-image', filePath);
      destroyDocxEditor();
      openFile = file.path;
      officeDocument = null; officeHash = null; officeDirty = false;
      document.getElementById('office-preview').hidden = true;
      savedContents = '';
      editor.value = '';
      setMarkdownPreview(false);
      updateCodeHighlight('', '');
      markdownToggle.hidden = true;
      codeEditorShell.hidden = true;
      document.getElementById('pdf-preview').hidden = true;
      document.getElementById('pdf-preview').src = 'about:blank';
      document.getElementById('image-preview').hidden = false;
      document.getElementById('image-zoom-out').hidden = false;
      document.getElementById('image-zoom-label').hidden = false;
      document.getElementById('image-fit').hidden = false;
      document.getElementById('image-zoom-in').hidden = false;
      document.getElementById('image-dimensions').hidden = false;
      document.getElementById('save-file').disabled = true;
      document.getElementById('save-status').textContent = '';
      const image = document.getElementById('workspace-image');
      image.onload = () => {
        document.getElementById('image-dimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
        imageFit = true; imageZoom = 1; updateImageZoom();
      };
      image.onerror = () => { document.getElementById('image-dimensions').textContent = t('无法解码这张图片。'); };
      image.src = `data:${file.mimeType};base64,${file.data}`;
      image.alt = file.path;
      document.getElementById('editor-path').textContent = file.path;
      document.getElementById('editor-path').title = file.path;
      updateFileSelection();
      return;
    }
    if (/\.pdf$/i.test(filePath)) {
      const file = await ipcRenderer.invoke('read-workspace-pdf', filePath);
      destroyDocxEditor();
      openFile = file.path; savedContents = ''; editor.value = '';
      officeDocument = null; officeHash = null; officeDirty = false;
      document.getElementById('office-preview').hidden = true;
      updateCodeHighlight('', '');
      codeEditorShell.hidden = true;
      markdownPreview.hidden = true; markdownToggle.hidden = true;
      document.getElementById('image-preview').hidden = true;
      for (const id of ['image-dimensions', 'image-zoom-out', 'image-zoom-label', 'image-fit', 'image-zoom-in']) document.getElementById(id).hidden = true;
      document.getElementById('pdf-preview').hidden = false;
      document.getElementById('pdf-preview').src = file.url;
      document.getElementById('save-file').disabled = true;
      document.getElementById('save-status').textContent = '';
      document.getElementById('editor-path').textContent = file.path;
      document.getElementById('editor-path').title = file.path;
      updateFileSelection();
      return;
    }
    if (/\.(?:docx|xlsx|csv|tsv)$/i.test(filePath)) {
      const file = await ipcRenderer.invoke('read-workspace-office', filePath);
      openFile = file.path; savedContents = ''; editor.value = '';
      updateCodeHighlight('', '');
      renderOfficeFile(file);
      document.getElementById('editor-path').textContent = file.path;
      document.getElementById('editor-path').title = file.path;
      updateFileSelection();
      return;
    }
    const file = await ipcRenderer.invoke('read-workspace-file', filePath);
    destroyDocxEditor();
    openFile = file.path;
    officeDocument = null; officeHash = null; officeDirty = false;
    document.getElementById('office-preview').hidden = true;
    updateFileSelection();
    savedContents = file.content;
    editor.value = file.content;
    updateCodeHighlight(file.path, file.content);
    codeEditorShell.hidden = false;
    document.getElementById('image-preview').hidden = true;
    document.getElementById('office-preview').hidden = true;
    document.getElementById('pdf-preview').hidden = true;
    document.getElementById('pdf-preview').src = 'about:blank';
    document.getElementById('image-zoom-out').hidden = true;
    document.getElementById('image-zoom-label').hidden = true;
    document.getElementById('image-fit').hidden = true;
    document.getElementById('image-zoom-in').hidden = true;
    document.getElementById('image-dimensions').hidden = true;
    setMarkdownPreview(false);
    markdownToggle.hidden = !/\.md(?:own)?$/i.test(file.path);
    document.getElementById('editor-path').textContent = file.path;
    document.getElementById('editor-path').title = file.path;
    document.getElementById('save-file').disabled = false;
    document.getElementById('save-status').textContent = '';
  } catch (error) { window.alert(t(error.message)); }
}
const codeKeywords = new Set('alignas alignof asm auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while async await as assert def del elif except finally from global import lambda nonlocal pass raise with yield function let var interface implements package super throws abstract final native synchronized transient instanceof debugger typeof in of get set'.split(/\s+/));
const codeTypes = new Set('int float double char bool void string auto size_t uint32_t uint64_t int32_t int64_t vector map set list pair optional unique_ptr shared_ptr std FILE'.split(/\s+/));
function escapeCodeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function updateCodeHighlight(filePath, source) {
  const extension = String(filePath).split('.').pop().toLowerCase();
  const codeExtensions = new Set(['c', 'h', 'cc', 'hh', 'cpp', 'cxx', 'hpp', 'hxx', 'ino', 'cs', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'java', 'py', 'go', 'rs', 'php', 'swift', 'kt', 'json', 'css', 'html', 'xml', 'sh', 'sql']);
  const enabled = codeExtensions.has(extension);
  codeEditorShell.classList.toggle('highlight-enabled', enabled);
  codeEditorShell.classList.toggle('code-theme', enabled);
  document.querySelector('.editor-panel').classList.toggle('code-theme', enabled);
  const pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|^\s*#.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/gm;
  let output = ''; let cursor = 0; let match;
  while ((match = pattern.exec(source))) {
    output += escapeCodeHtml(source.slice(cursor, match.index));
    const token = match[0]; let kind = '';
    if (token.startsWith('//') || token.startsWith('/*')) kind = 'comment';
    else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) kind = 'string';
    else if (/^\s*#/.test(token)) kind = 'preprocessor';
    else if (/^\d/.test(token)) kind = 'number';
    else if (codeKeywords.has(token)) kind = 'keyword';
    else if (codeTypes.has(token)) kind = 'type';
    else if (/^\s*\(/.test(source.slice(pattern.lastIndex))) kind = 'function';
    output += kind ? `<span class="syntax-${kind}">${escapeCodeHtml(token)}</span>` : escapeCodeHtml(token);
    cursor = pattern.lastIndex;
  }
  output += escapeCodeHtml(source.slice(cursor));
  codeHighlight.innerHTML = `<code>${output || ' '}</code>`;
}

function updateImageZoom() {
  const image = document.getElementById('workspace-image');
  const canvas = document.getElementById('image-canvas');
  document.getElementById('image-zoom-label').textContent = imageFit ? t('适应窗口') : `${Math.round(imageZoom * 100)}%`;
  canvas.classList.toggle('fit', imageFit);
  if (imageFit) { image.style.width = ''; image.style.height = ''; }
  else { image.style.width = `${Math.round(image.naturalWidth * imageZoom)}px`; image.style.height = `${Math.round(image.naturalHeight * imageZoom)}px`; }
}
function stepImageZoom(factor) {
  const image = document.getElementById('workspace-image');
  if (!image.naturalWidth) return;
  const currentScale = imageFit ? image.getBoundingClientRect().width / image.naturalWidth : imageZoom;
  imageZoom = Math.max(.01, Math.min(8, currentScale * factor));
  imageFit = false; updateImageZoom();
}
document.getElementById('image-preview').addEventListener('wheel', (event) => {
  if (!event.deltaY) return;
  event.preventDefault();
  const preview = event.currentTarget; const image = document.getElementById('workspace-image');
  if (!image.naturalWidth) return;
  const bounds = image.getBoundingClientRect(); const viewport = preview.getBoundingClientRect();
  const ratioX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const ratioY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
  const scale = imageFit ? bounds.width / image.naturalWidth : imageZoom;
  imageZoom = Math.max(.01, Math.min(8, scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
  imageFit = false; updateImageZoom();
  requestAnimationFrame(() => {
    const next = image.getBoundingClientRect();
    preview.scrollLeft += next.left - bounds.left + ratioX * next.width - (event.clientX - viewport.left);
    preview.scrollTop += next.top - bounds.top + ratioY * next.height - (event.clientY - viewport.top);
  });
}, { passive: false });
document.getElementById('image-zoom-out').addEventListener('click', () => stepImageZoom(1 / 1.25));
document.getElementById('image-zoom-in').addEventListener('click', () => stepImageZoom(1.25));
document.getElementById('image-fit').addEventListener('click', () => { imageFit = true; imageZoom = 1; updateImageZoom(); });
function setMarkdownPreview(enabled) {
  if (enabled) window.renderMurasameMarkdown(markdownPreview, editor.value);
  markdownPreview.hidden = !enabled;
  const imageVisible = !document.getElementById('image-preview').hidden;
  const pdfVisible = !document.getElementById('pdf-preview').hidden;
  const canShowEditor = !enabled && !officeDocument && !imageVisible && !pdfVisible;
  codeEditorShell.hidden = !canShowEditor;
  document.querySelector('.editor-panel').classList.toggle('code-theme', canShowEditor && codeEditorShell.classList.contains('highlight-enabled'));
  markdownToggle.textContent = t(enabled ? '查看源码' : '渲染预览');
  markdownToggle.setAttribute('aria-pressed', String(enabled));
}
markdownToggle.addEventListener('click', () => setMarkdownPreview(markdownPreview.hidden));
editor.addEventListener('input', () => {
  updateCodeHighlight(document.getElementById('editor-path').textContent, editor.value);
  document.getElementById('save-status').textContent = editor.value === savedContents ? '' : t('未保存');
});
editor.addEventListener('scroll', () => { codeHighlight.scrollTop = editor.scrollTop; codeHighlight.scrollLeft = editor.scrollLeft; });
document.getElementById('save-file').addEventListener('click', async () => {
  if (await saveOpenFile()) setTimeout(() => { if (document.getElementById('save-status').textContent === t('已保存')) document.getElementById('save-status').textContent = ''; }, 1600);
});
document.getElementById('refresh-files').addEventListener('click', refreshFiles);
document.getElementById('file-search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLocaleLowerCase();
  fileList.querySelectorAll('.file-entry[data-path]').forEach((button) => {
    button.hidden = Boolean(query && !button.dataset.search.includes(query) && !button.dataset.path.toLocaleLowerCase().includes(query));
  });
});

async function refreshChanges() {
  const panel = document.getElementById('change-review');
  try {
    const result = await ipcRenderer.invoke('get-workspace-changes');
    panel.hidden = !result.files.length && !result.ownChanges.length;
    document.getElementById('change-count').textContent = result.ownChanges.length ? `(${result.ownChanges.length} ${t('本次任务')})` : (result.files.length ? `(${result.files.length})` : '');
    const list = document.getElementById('change-list'); list.replaceChildren();
    result.ownChanges.forEach((change) => {
      const row = document.createElement('div'); row.className = 'change-row';
      const label = document.createElement('span'); label.textContent = `${t(change.added ? '新增' : change.removed ? '删除' : '修改')} · ${change.file}`;
      row.append(label);
      const revert = document.createElement('button'); revert.type = 'button'; revert.textContent = t('撤销此文件');
      revert.addEventListener('click', async () => {
        if (!window.confirm(`${t('恢复任务前版本？')}\n${change.file}`)) return;
        try { await ipcRenderer.invoke('revert-agent-file', change.file); await refreshChanges(); await refreshFiles(); }
        catch (error) { showNotice(error.message, true); }
      }); row.append(revert); list.append(row);
    });
    if (!result.ownChanges.length) result.files.forEach((line) => { const item = document.createElement('div'); item.textContent = line; list.append(item); });
    document.getElementById('change-diff').textContent = result.diff || t('没有已跟踪文件的差异；新增文件仍列在上方。');
  } catch { panel.hidden = true; }
}

function appendTerminal(text) {
  terminalOutput.dataset.used = 'true';
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
  terminalHistory.unshift(command); terminalHistory = terminalHistory.slice(0, 100); terminalHistoryIndex = -1;
  document.getElementById('run-command').disabled = true;
  document.getElementById('stop-command').hidden = false;
  appendTerminal(`\n$ ${command}\n`);
  input.value = '';
  try {
    const result = await ipcRenderer.invoke('run-terminal', command);
    if (result.error) appendTerminal(`${result.error}\n`);
    else if (result.code !== 0) appendTerminal(`\n${t('命令退出，代码：')}${result.code}\n`);
  } catch (error) { appendTerminal(`${error.message}\n`); }
  finally {
    terminalRunning = false;
    document.getElementById('run-command').disabled = false;
    document.getElementById('stop-command').hidden = true;
  }
});
document.getElementById('terminal-command').addEventListener('keydown', (event) => {
  const input = event.currentTarget;
  if (event.key === 'ArrowUp' && (terminalHistoryIndex < terminalHistory.length - 1)) {
    event.preventDefault(); terminalHistoryIndex++; input.value = terminalHistory[terminalHistoryIndex] || '';
  } else if (event.key === 'ArrowDown' && terminalHistoryIndex >= 0) {
    event.preventDefault(); terminalHistoryIndex--; input.value = terminalHistoryIndex < 0 ? '' : terminalHistory[terminalHistoryIndex];
  }
});
document.getElementById('stop-command').addEventListener('click', () => ipcRenderer.send('stop-terminal'));
document.getElementById('clear-terminal').addEventListener('click', () => { terminalOutput.textContent = ''; });

initializeAppearance();
refreshWorkspace();
