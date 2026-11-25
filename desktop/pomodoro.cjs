// Pure clock model. The main process owns scheduling and persistence.
const DEFAULTS = { focus: 25, shortBreak: 5, longBreak: 15, interval: 4, autoStart: false, sound: true, notifications: true };
function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function settingsFor(input = {}) {
  const result = { ...DEFAULTS };
  for (const key of ['focus', 'shortBreak', 'longBreak', 'interval']) {
    const max = key === 'interval' ? 12 : 180;
    if (Number.isInteger(input[key]) && input[key] >= 1 && input[key] <= max) result[key] = input[key];
  }
  for (const key of ['autoStart', 'sound', 'notifications']) if (typeof input[key] === 'boolean') result[key] = input[key];
  return result;
}
class Pomodoro {
  constructor(saved = {}, now = Date.now()) {
    this.settings = settingsFor(saved.settings);
    this.phase = ['focus', 'shortBreak', 'longBreak'].includes(saved.phase) ? saved.phase : 'focus';
    this.status = ['running', 'paused'].includes(saved.status) ? 'paused' : saved.status === 'ready' ? 'ready' : 'idle';
    this.cycle = Number.isInteger(saved.cycle) && saved.cycle >= 0 && saved.cycle <= 12 ? saved.cycle : 0;
    this.durationMs = Number.isFinite(saved.durationMs) && saved.durationMs > 0 && saved.durationMs <= 180 * 60000 ? saved.durationMs : this.duration();
    this.remainingMs = Number.isFinite(saved.remainingMs) ? Math.max(0, Math.min(this.durationMs, saved.remainingMs)) : this.durationMs;
    this.stats = saved.stats && typeof saved.stats === 'object' ? saved.stats : {};
    this.deadline = null;
    this.accountedAt = now;
  }
  duration() { return this.settings[this.phase] * 60000; }
  record(time) {
    const key = dayKey(time);
    if (!this.stats[key]) this.stats[key] = { count: 0, focusMs: 0 };
    return this.stats[key];
  }
  account(now) {
    if (this.status !== 'running') return;
    const end = Math.min(now, this.deadline);
    if (this.phase === 'focus') {
      let start = this.accountedAt;
      while (start < end) {
        const date = new Date(start);
        date.setHours(24, 0, 0, 0);
        const until = Math.min(end, date.getTime());
        this.record(start).focusMs += until - start;
        start = until;
      }
    }
    this.accountedAt = Math.max(this.accountedAt, end);
    this.remainingMs = Math.max(0, this.deadline - now);
  }
  tick(now = Date.now()) {
    this.account(now);
    if (this.status !== 'running' || this.remainingMs > 0) return null;
    const completed = this.phase;
    if (completed === 'focus') {
      this.record(this.deadline).count++;
      this.cycle++;
      this.phase = this.cycle >= this.settings.interval ? 'longBreak' : 'shortBreak';
    } else {
      if (completed === 'longBreak') this.cycle = 0;
      this.phase = 'focus';
    }
    this.status = 'ready';
    this.deadline = null;
    this.durationMs = this.duration();
    this.remainingMs = this.durationMs;
    if (this.settings.autoStart) this.start(now);
    return completed;
  }
  start(now) {
    if (this.status === 'running') return;
    this.status = 'running';
    this.accountedAt = now;
    this.deadline = now + this.remainingMs;
  }
  action(action, now = Date.now()) {
    if (action === 'start') this.start(now);
    else if (action === 'pause' && this.status === 'running') {
      this.account(now); this.status = 'paused'; this.deadline = null;
    } else if (action === 'restart' || action === 'stop') {
      this.account(now);
      if (action === 'stop') { this.phase = 'focus'; this.cycle = 0; }
      this.durationMs = this.duration(); this.remainingMs = this.durationMs;
      this.status = action === 'stop' ? 'idle' : 'paused'; this.deadline = null;
    }
  }
  configure(input) {
    for (const key of ['focus', 'shortBreak', 'longBreak', 'interval']) {
      if (key in input && (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > (key === 'interval' ? 12 : 180))) {
        throw new RangeError('时长须为 1–180 的整数，长休息间隔须为 1–12 的整数。');
      }
    }
    for (const key of ['autoStart', 'sound', 'notifications']) {
      if (key in input && typeof input[key] !== 'boolean') throw new TypeError('提醒和自动开始设置无效。');
    }
    this.settings = settingsFor({ ...this.settings, ...input });
    if (this.status === 'idle' || this.status === 'ready') {
      this.durationMs = this.duration(); this.remainingMs = this.durationMs;
    }
  }
  snapshot(now = Date.now()) {
    return { settings: { ...this.settings }, phase: this.phase, status: this.status, cycle: this.cycle,
      remainingMs: this.remainingMs, durationMs: this.durationMs, stats: this.stats,
      today: { ...(this.stats[dayKey(now)] || { count: 0, focusMs: 0 }) } };
  }
}
module.exports = { Pomodoro, dayKey };
