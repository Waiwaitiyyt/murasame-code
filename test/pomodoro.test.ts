import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const { Pomodoro, dayKey } = createRequire(import.meta.url)('../desktop/pomodoro.cjs');

test('pause and resume preserve time and exclude the paused interval from focus totals', () => {
  const clock = new Pomodoro();
  clock.action('start', 0);
  clock.tick(10000);
  clock.action('pause', 20000);
  assert.equal(clock.remainingMs, 25 * 60000 - 20000);
  clock.tick(50000);
  clock.action('start', 100000);
  clock.tick(110000);
  assert.equal(clock.remainingMs, 25 * 60000 - 30000);
  assert.equal(clock.snapshot(110000).today.focusMs, 30000);
  clock.action('stop', 115000);
  assert.equal(clock.snapshot(115000).today.focusMs, 35000);
  assert.equal(clock.snapshot(115000).today.count, 0);
  assert.equal(clock.status, 'idle');
});

test('four completed focus rounds lead to a long break and reset the next cycle', () => {
  const clock = new Pomodoro();
  clock.configure({ focus: 1, shortBreak: 1, longBreak: 2 });
  let now = 0;
  for (let round = 1; round <= 4; round++) {
    clock.action('start', now);
    now += 60000;
    assert.equal(clock.tick(now), 'focus');
    assert.equal(clock.phase, round === 4 ? 'longBreak' : 'shortBreak');
    assert.equal(clock.status, 'ready');
    assert.equal(clock.snapshot(now).today.count, round);
    // Waiting at a phase boundary cannot earn more tomatoes.
    assert.equal(clock.tick(now + 1000), null);
    clock.action('start', now);
    now += round === 4 ? 120000 : 60000;
    clock.tick(now);
    assert.equal(clock.phase, 'focus');
  }
  assert.equal(clock.cycle, 0);
  assert.equal(clock.snapshot(now).today.focusMs, 240000);
});

test('wake from sleep finishes once and starts the next automatic phase from wake time', () => {
  const clock = new Pomodoro();
  clock.configure({ focus: 1, shortBreak: 1, autoStart: true });
  clock.action('start', 0);
  assert.equal(clock.tick(8 * 3600000), 'focus');
  assert.equal(clock.phase, 'shortBreak');
  assert.equal(clock.status, 'running');
  assert.equal(clock.remainingMs, 60000);
  assert.equal(clock.tick(8 * 3600000), null);
  assert.equal(clock.snapshot(0).today.count, 1);
  assert.equal(clock.snapshot(0).today.focusMs, 60000);
});

test('persisted running sessions reopen paused, without counting time while the app is closed', () => {
  const clock = new Pomodoro();
  clock.action('start', 0);
  clock.tick(12000);
  const saved = JSON.parse(JSON.stringify(clock.snapshot(12000)));
  const restored = new Pomodoro(saved, 10000000);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.remainingMs, 25 * 60000 - 12000);
  restored.tick(20000000);
  assert.equal(restored.remainingMs, saved.remainingMs);
  restored.action('start', 20000000);
  restored.tick(20003000);
  assert.equal(restored.remainingMs, saved.remainingMs - 3000);
});

test('focus time is split at local midnight and completion belongs to its actual day', () => {
  const start = new Date(2026, 10, 25, 23, 59, 30).getTime();
  const clock = new Pomodoro({}, start);
  clock.configure({ focus: 1 });
  clock.action('start', start);
  clock.tick(start + 5 * 60000);
  assert.deepEqual(clock.stats[dayKey(start)], { count: 0, focusMs: 30000 });
  assert.deepEqual(clock.stats[dayKey(start + 60000)], { count: 1, focusMs: 30000 });
});

test('settings protect an active duration, apply on restart, and reject invalid values', () => {
  const clock = new Pomodoro();
  clock.action('start', 0);
  clock.configure({ focus: 45, interval: 2 });
  assert.equal(clock.remainingMs, 25 * 60000);
  assert.equal(clock.durationMs, 25 * 60000);
  clock.action('restart', 10000);
  assert.equal(clock.remainingMs, 45 * 60000);
  assert.equal(clock.status, 'paused');
  assert.throws(() => clock.configure({ focus: -1, interval: Infinity }));
  assert.throws(() => clock.configure({ sound: 'false' }));
  assert.equal(clock.settings.focus, 45);
  assert.equal(clock.settings.interval, 2);
  assert.equal(clock.settings.sound, true);
});

test('ready and paused phases survive restart, including break duration and round', () => {
  const clock = new Pomodoro();
  clock.configure({ focus: 1 });
  clock.action('start', 0);
  clock.tick(60000);
  const restored = new Pomodoro(JSON.parse(JSON.stringify(clock.snapshot())));
  assert.equal(restored.status, 'ready');
  assert.equal(restored.phase, 'shortBreak');
  assert.equal(restored.cycle, 1);
  assert.equal(restored.remainingMs, 5 * 60000);
});

test('reopening during a long break preserves the completed round number', () => {
  const clock = new Pomodoro();
  clock.configure({ focus: 1, interval: 1 });
  clock.action('start', 0);
  clock.tick(60000);
  const restored = new Pomodoro(JSON.parse(JSON.stringify(clock.snapshot())));
  assert.equal(restored.phase, 'longBreak');
  assert.equal(restored.cycle, 1);
  restored.action('start', 100000);
  restored.tick(100000 + 15 * 60000);
  assert.equal(restored.phase, 'focus');
  assert.equal(restored.cycle, 0);
});
