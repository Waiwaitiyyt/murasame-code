#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
if (!existsSync(entry)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  console.error(
    '未找到编译产物 dist/index.js。请先在项目目录运行 `npm install && npm run build`，或使用 `npm run dev` 直接运行。',
  );
  process.exit(1);
}

await import('../dist/index.js');
