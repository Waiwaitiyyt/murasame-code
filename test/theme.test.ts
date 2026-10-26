import assert from 'node:assert/strict';
import test from 'node:test';
import stringWidth from 'string-width';
import { buildBanner } from '../src/theme.js';

test('banner fits terminal widths without wrapping the logo or info box', () => {
  const opts = { provider: 'openai', model: 'gpt-4o', cwd: '/工作区/项目/🌸' };

  for (let columns = 1; columns <= 160; columns++) {
    const { mode, logo, box } = buildBanner(opts, columns);
    for (const line of [...logo, ...box]) {
      assert.ok(stringWidth(line) <= columns, `line exceeds ${columns} columns: ${line}`);
    }
    assert.ok(box.every((line) => stringWidth(line) === stringWidth(box[0])));
    if (mode === 'inline') {
      assert.ok(logo[0].length + 2 + box[0].length <= columns);
    }
  }

  assert.equal(buildBanner(opts, 140).mode, 'inline');
  assert.equal(buildBanner(opts, 40).logo.length, 5);
  assert.deepEqual(buildBanner(opts, 20).logo, ['MURASAME']);
});
