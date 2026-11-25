/* Shared display helpers for the control panel and compact pet card. */
const pomodoroIPC = require('electron').ipcRenderer;
const phaseNames = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' };
let pomodoroState = null;
function formatPomodoroTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function phaseTitle(state) {
  return `${phaseNames[state.phase]} · 第 ${state.phase === 'focus' ? state.cycle + 1 : state.cycle} 轮`;
}
function toggleText(state) {
  if (state.status === 'running') return '暂停';
  if (state.status === 'paused') return '继续';
  return `开始${phaseNames[state.phase]}`;
}
async function pomodoroCommand(action, settings) {
  try {
    renderPomodoro(await pomodoroIPC.invoke('pomodoro-command', action, settings));
    return true;
  }
  catch (error) {
    const feedback = document.getElementById('feedback');
    if (feedback) feedback.textContent = `操作失败：${error.message}`;
    return false;
  }
}
function renderPomodoro(state) {
  pomodoroState = state;
  const card = document.getElementById('pomodoro-card');
  if (card) {
    card.hidden = state.status === 'idle';
    document.getElementById('pomodoro-label').textContent = phaseTitle(state);
    document.getElementById('pomodoro-time').textContent = formatPomodoroTime(state.remainingMs);
    document.getElementById('pomodoro-toggle').textContent = toggleText(state);
    return;
  }
  document.getElementById('phase').textContent = phaseTitle(state);
  document.getElementById('time').textContent = formatPomodoroTime(state.remainingMs);
  document.getElementById('toggle').textContent = toggleText(state);
  document.getElementById('progress').value = Math.max(0, 1 - state.remainingMs / state.durationMs);
  document.getElementById('status').textContent = { idle: '准备好就开始吧～', running: state.phase === 'focus' ? '丛雨陪你一起专注。' : '放松一下，看看远处吧～', paused: '已暂停，准备好后继续。', ready: '上一阶段完成，准备好后开始下一段。' }[state.status];
  document.getElementById('count').textContent = state.today.count;
  document.getElementById('minutes').textContent = Math.floor(state.today.focusMs / 60000);
}
pomodoroIPC.on('pomodoro-state', (_event, state) => renderPomodoro(state));
document.addEventListener('DOMContentLoaded', async () => {
  const card = document.getElementById('pomodoro-card');
  if (card) {
    document.getElementById('pomodoro-open').onclick = () => pomodoroIPC.send('open-pomodoro');
    document.getElementById('pomodoro-toggle').onclick = () => pomodoroCommand(pomodoroState?.status === 'running' ? 'pause' : 'start');
    document.getElementById('pomodoro-stop').onclick = () => pomodoroCommand('stop');
  } else {
    document.getElementById('toggle').onclick = () => pomodoroCommand(pomodoroState?.status === 'running' ? 'pause' : 'start');
    document.querySelectorAll('[data-action]').forEach(button => { button.onclick = () => pomodoroCommand(button.dataset.action); });
  }
  try {
    const state = await pomodoroIPC.invoke('get-pomodoro');
    renderPomodoro(state);
    if (card) return;
    const form = document.getElementById('settings');
    for (const [key, value] of Object.entries(state.settings)) {
      const input = form.elements.namedItem(key);
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const settings = {};
      for (const key of Object.keys(state.settings)) {
        const input = form.elements.namedItem(key);
        settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      }
      if (await pomodoroCommand('settings', settings)) document.getElementById('feedback').textContent = '设置已保存';
    };
  } catch (error) {
    const feedback = document.getElementById('feedback');
    if (feedback) feedback.textContent = `读取失败：${error.message}`;
  }
});
