const { app, BrowserWindow, Menu, Tray, screen, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { createHash } = require('crypto');
const Store = require('electron-store');
const { pathToFileURL } = require('url');
const { languageNames, detectLanguage, translator } = require('./i18n');

const store = new Store();
const isWindows = process.platform === 'win32';
const isLinux   = process.platform === 'linux';
const isMac     = process.platform === 'darwin';

// 避免 Windows 上 GPU 缓存目录权限报错
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
let appWindow = null;
let tray = null;
const codeRoot = path.resolve(__dirname, '..');
const config = new Store({ name: 'murasame-desktop' });
const sessions = new Store({ name: 'murasame-sessions' });
let agentModules = null;
let agentRunning = false;
let currentAgentController = null;
let terminalProcess = null;

function createAppWindow() {
  if (appWindow) { appWindow.show(); appWindow.focus(); return; }
  appWindow = new BrowserWindow({
    width: 1180, height: 800, minWidth: 780, minHeight: 560,
    title: '丛雨代码', backgroundColor: '#f7f3fa',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  appWindow.loadFile(path.join(__dirname, 'desktop.html'));
  appWindow.on('close', (event) => {
    if (!app.isQuitting) { event.preventDefault(); appWindow.hide(); }
  });
  appWindow.on('closed', () => { appWindow = null; });
}

async function getAgentModules() {
  if (agentModules) return agentModules;
  const load = (file) => import(pathToFileURL(path.join(codeRoot, 'dist', file)).href);
  const [configModule, llmModule, agentModule, permissionsModule, i18nModule] = await Promise.all([
    load('config.js'), load('llm.js'), load('agent.js'), load('permissions.js'), load('i18n.js'),
  ]);
  agentModules = { ...configModule, ...llmModule, ...agentModule, ...permissionsModule, ...i18nModule };
  return agentModules;
}

function sessionKey(cwd) {
  return createHash('sha256').update(path.resolve(cwd)).digest('hex');
}

function workspacePath(relativePath = '') {
  const root = path.resolve(config.get('workspace', os.homedir()));
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径超出当前工作目录。');
  return { root, resolved };
}

async function verifyWorkspacePath(relativePath = '') {
  const { root, resolved } = workspacePath(relativePath);
  const realRoot = await fs.promises.realpath(root);
  const realTarget = await fs.promises.realpath(resolved);
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径超出当前工作目录。');
  return { root: realRoot, target: realTarget };
}

const ignoredWorkspaceEntries = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);

async function listWorkspaceFiles(directory = '') {
  const { target } = await verifyWorkspacePath(directory);
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => !ignoredWorkspaceEntries.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 500)
    .map((entry) => ({
      name: entry.name,
      path: path.posix.join(directory.replace(/\\/g, '/'), entry.name),
      directory: entry.isDirectory(),
    }));
}


function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const defaultX = sw - 150 - 20;
  const defaultY = sh - 340 - 20;
  const winX = store.get('windowX', defaultX);
  const winY = store.get('windowY', defaultY);

  const opts = {
    width: 150,
    height: 340,
    x: winX,
    y: winY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // 允许加载上级目录的本地PNG文件
    },
  };

  if (isLinux) opts.type = 'toolbar'; // Linux：避免显示在任务栏

  mainWindow = new BrowserWindow(opts);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Windows：初始启用鼠标穿透，鼠标进入角色时由渲染进程关闭
  if (isWindows) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowX', x);
    store.set('windowY', y);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function changeCostume(key) {
  store.set('costume', key);
  if (mainWindow) mainWindow.webContents.send('pet-action', 'costume:' + key);
}

function getLanguage() {
  return store.get('language', detectLanguage(app.getLocale()));
}

function changeLanguage(lang) {
  store.set('language', lang);
  refreshTray();
}

function buildMenu() {
  const costume = store.get('costume', 'sword');
  const lang = getLanguage();
  const t = translator(lang);
  return Menu.buildFromTemplate([
    {
      label: t('sleep'),
      click: () => { if (mainWindow) mainWindow.webContents.send('pet-action', 'sleep'); },
    },
    {
      label: t('hide'),
      click: () => { if (mainWindow) mainWindow.hide(); },
    },
    {
      label: t('summon'),
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.webContents.send('pet-action', 'idle'); }
        else createWindow();
      },
    },
    { label: '打开丛雨代码', click: () => createAppWindow() },
    { type: 'separator' },
    {
      label: t('costume'),
      submenu: [
        { label: t('sword'),   type: 'radio', checked: costume === 'sword',   click: () => changeCostume('sword') },
        { label: t('uniform'), type: 'radio', checked: costume === 'uniform', click: () => changeCostume('uniform') },
        { label: t('dress'),   type: 'radio', checked: costume === 'dress',   click: () => changeCostume('dress') },
      ],
    },
    {
      label: t('settings'),
      submenu: [
        {
          label: t('autostart'),
          type: 'checkbox',
          checked: getAutostart(),
          click: (item) => setAutostart(item.checked),
        },
        {
          label: t('alwaysOnTop'),
          type: 'checkbox',
          checked: mainWindow ? mainWindow.isAlwaysOnTop() : true,
          click: (item) => { if (mainWindow) mainWindow.setAlwaysOnTop(item.checked); },
        },
        {
          label: t('language'),
          submenu: Object.entries(languageNames).map(([key, name]) => ({
            label: name,
            type: 'radio',
            checked: lang === key,
            click: () => changeLanguage(key),
          })),
        },
      ],
    },
    { type: 'separator' },
    { label: t('quit'), click: () => app.quit() },
  ]);
}

// 语言切换后刷新托盘提示与菜单（Windows 每次右键都会重建，无需 setContextMenu）
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(translator(getLanguage())('appName'));
  if (!isWindows) tray.setContextMenu(buildMenu());
}

function setupTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(isLinux ? icon.resize({ width: 22, height: 22 }) : icon);

  if (isWindows) {
    // Windows 每次右键重建菜单，确保 checkbox 状态最新
    tray.on('right-click', () => {
      tray.popUpContextMenu(buildMenu());
    });
  }
  refreshTray();

  tray.on('click', () => createAppWindow());
}

// ---- 自启动 ----

function getAutostart() {
  if (isWindows || isMac) return app.getLoginItemSettings().openAtLogin;
  if (isLinux) return fs.existsSync(path.join(os.homedir(), '.config', 'autostart', 'murasame-pet.desktop'));
  return false;
}

function setAutostart(enable) {
  if (isWindows || isMac) { app.setLoginItemSettings({ openAtLogin: enable }); return; }
  if (isLinux) {
    const dir  = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'murasame-pet.desktop');
    if (enable) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file,
        `[Desktop Entry]\nType=Application\nName=丛雨桌宠\nExec=${process.execPath} ${__dirname}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`
      );
    } else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

// ---- IPC ----

ipcMain.on('toggle-click-through', (event, enable) => {
  if (isWindows && mainWindow) mainWindow.setIgnoreMouseEvents(enable, { forward: true });
});

ipcMain.on('get-platform', (event) => { event.returnValue = process.platform; });

ipcMain.on('get-costume', (event) => { event.returnValue = store.get('costume', 'sword'); });

ipcMain.on('get-fgimages-path', (event) => {
  const devPath  = path.join(__dirname, 'fgimages');
  const prodPath = path.join(process.resourcesPath || '', 'fgimages');
  event.returnValue = app.isPackaged ? prodPath : (fs.existsSync(devPath) ? devPath : prodPath);
});

ipcMain.on('move-window', (event, { x, y }) => {
  if (mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.on('show-context-menu', () => {
  if (!mainWindow) return;
  buildMenu().popup({ window: mainWindow });
});

ipcMain.handle('choose-workspace', async () => {
  const result = await dialog.showOpenDialog(appWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  config.set('workspace', result.filePaths[0]);
  return result.filePaths[0];
});
ipcMain.handle('get-workspace', () => config.get('workspace', os.homedir()));
ipcMain.handle('list-workspace-files', (_event, directory) => listWorkspaceFiles(directory));
ipcMain.handle('read-workspace-file', async (_event, relativePath) => {
  const { target } = await verifyWorkspacePath(relativePath);
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new Error('只能打开文件。');
  if (stat.size > 1_000_000) throw new Error('文件超过 1 MB，暂不支持在编辑器中打开。');
  const content = await fs.promises.readFile(target);
  if (content.includes(0)) throw new Error('这是二进制文件，不能作为文本编辑。');
  return { path: relativePath, content: content.toString('utf8') };
});
ipcMain.handle('save-workspace-file', async (_event, relativePath, content) => {
  const { target } = await verifyWorkspacePath(relativePath);
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new Error('只能保存文件。');
  if (Buffer.byteLength(content, 'utf8') > 1_000_000) throw new Error('文件超过 1 MB，暂不支持在编辑器中保存。');
  await fs.promises.writeFile(target, content, 'utf8');
  return true;
});
ipcMain.handle('get-session', async () => {
  const cwd = config.get('workspace', os.homedir());
  const modules = await getAgentModules();
  const conversation = sessions.get(sessionKey(cwd), null) || modules.newConversation(cwd);
  return conversation.filter((message) => message.role !== 'system').map((message) => {
    if (message.role === 'tool') return { type: 'tool', name: message.name, content: message.content };
    if (message.role === 'assistant' && message.toolCalls.length) {
      return { type: 'action', content: message.content, tools: message.toolCalls.map((call) => ({ name: call.name, input: call.input })) };
    }
    return { type: 'message', role: message.role, content: message.content };
  });
});
ipcMain.handle('new-session', async () => {
  const cwd = config.get('workspace', os.homedir());
  const { newConversation } = await getAgentModules();
  sessions.set(sessionKey(cwd), newConversation(cwd));
  return true;
});
ipcMain.handle('run-murasame', async (_event, prompt) => {
  if (agentRunning) return { error: '丛雨正在处理上一项任务。' };
  if (!prompt || !prompt.trim()) return { error: '请输入要完成的任务。' };
  const cwd = config.get('workspace', os.homedir());
  const key = sessionKey(cwd);
  let conversation;
  let abortController;
  agentRunning = true;
  try {
    const modules = await getAgentModules();
    const cfg = modules.resolveConfig();
    modules.setLanguage(cfg.language);
    if (!cfg.apiKey) return { error: '还没有配置模型接口，请先在终端运行 murasame --configure。' };
    conversation = sessions.get(key, null) || modules.newConversation(cwd);
    abortController = new AbortController();
    currentAgentController = abortController;
    const permissionManager = new modules.PermissionManager(
      cfg.permissionMode,
      cfg.approvedActions,
      modules.writeConfigFile,
      cwd,
    );
    await modules.runTurn(
      modules.createClient(cfg), conversation, prompt,
      {
        onTextDelta: (delta) => appWindow?.webContents.send('agent-event', { type: 'text', delta }),
        onActionTitle: (title) => appWindow?.webContents.send('agent-event', { type: 'action', title }),
        onToolResult: (call, ok, result) => {
          appWindow?.webContents.send('agent-event', { type: 'tool', name: call.name, target: modules.toolTarget(call, cwd), ok, result });
          sessions.set(key, conversation);
        },
        confirmTool: async (call) => {
          const detail = `${call.name}\n${JSON.stringify(call.input, null, 2)}`;
          const options = {
            type: 'warning', title: '丛雨请求执行工具', message: '是否允许丛雨执行这项操作？', detail,
            buttons: ['允许一次', '拒绝', '始终允许相同操作'], defaultId: 1, cancelId: 1,
          };
          const choice = appWindow?.isVisible()
            ? await dialog.showMessageBox(appWindow, options)
            : await dialog.showMessageBox(options);
          return choice.response === 0 ? 'yes' : choice.response === 2 ? 'always' : 'no';
        },
      },
      abortController.signal,
      cwd,
      permissionManager,
    );
    sessions.set(key, conversation);
    return { ok: true };
  } catch (error) {
    if (conversation) sessions.set(key, conversation);
    return { error: error.message || String(error) };
  } finally {
    agentRunning = false;
    currentAgentController = null;
    appWindow?.webContents.send('agent-event', { type: 'done' });
  }
});
ipcMain.handle('run-terminal', async (_event, command) => {
  if (!command || !command.trim()) return { error: '请输入终端命令。' };
  if (terminalProcess) return { error: '上一条终端命令仍在运行。' };
  const { target } = await verifyWorkspacePath('.');
  const executable = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';
  const args = isWindows ? ['/d', '/s', '/c', command] : ['-lc', command];
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: target, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    terminalProcess = child;
    child.stdout.on('data', (data) => appWindow?.webContents.send('terminal-output', data.toString()));
    child.stderr.on('data', (data) => appWindow?.webContents.send('terminal-output', data.toString()));
    child.on('error', (error) => { terminalProcess = null; resolve({ error: error.message }); });
    child.on('close', (code) => {
      terminalProcess = null;
      appWindow?.webContents.send('terminal-output', `\n[退出码 ${code}]\n`);
      resolve({ code });
    });
  });
});
ipcMain.on('stop-terminal', () => { terminalProcess?.kill(); });
ipcMain.on('minimize-to-pet', () => { appWindow?.hide(); if (mainWindow) mainWindow.show(); else createWindow(); });
ipcMain.on('minimize-to-tray', () => { appWindow?.hide(); mainWindow?.hide(); });
ipcMain.on('show-app', () => createAppWindow());
ipcMain.on('stop-agent', () => currentAgentController?.abort());

// ---- 应用生命周期 ----

app.whenReady().then(() => {
  createWindow();
  setupTray();
  if (!process.argv.includes('--pet-only')) createAppWindow();
});

app.on('before-quit', () => { app.isQuitting = true; terminalProcess?.kill(); });
app.on('window-all-closed', () => { /* 保持后台托盘运行 */ });
app.on('activate', () => {
  if (process.argv.includes('--pet-only')) {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  } else createAppWindow();
});
