import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import type { ToolDef } from './llm.js';
import { t } from './i18n.js';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// 工具定义（归一化 schema，按当前语言生成描述）
// ---------------------------------------------------------------------------

export function getToolDefs(): ToolDef[] {
  return [
    {
      name: 'read_file',
      description: t('tools.readFileDesc'),
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: t('tools.readFileFilePath') },
          offset: { type: 'number', description: t('tools.readFileOffset') },
          limit: { type: 'number', description: t('tools.readFileLimit') },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'write_file',
      description: t('tools.writeFileDesc'),
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: t('tools.writeFileFilePath') },
          content: { type: 'string', description: t('tools.writeFileContent') },
        },
        required: ['file_path', 'content'],
      },
    },
    {
      name: 'edit',
      description: t('tools.editDesc'),
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: t('tools.editFilePath') },
          old_string: { type: 'string', description: t('tools.editOldString') },
          new_string: { type: 'string', description: t('tools.editNewString') },
          replace_all: { type: 'boolean', description: t('tools.editReplaceAll') },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'bash',
      description: t('tools.bashDesc'),
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: t('tools.bashCommand') },
        },
        required: ['command'],
      },
    },
    {
      name: 'grep_search',
      description: t('tools.grepDesc'),
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: t('tools.grepPattern') },
          path: { type: 'string', description: t('tools.grepPath') },
          glob: { type: 'string', description: t('tools.grepGlob') },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'glob',
      description: t('tools.globDesc'),
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: t('tools.globPattern') },
          path: { type: 'string', description: t('tools.globPath') },
        },
        required: ['pattern'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 工具执行
// ---------------------------------------------------------------------------

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  switch (name) {
    case 'read_file':
      return readFile(input);
    case 'write_file':
      return writeFile(input);
    case 'edit':
      return editFile(input);
    case 'bash':
      return runBash(input, cwd);
    case 'grep_search':
      return grepSearch(input, cwd);
    case 'glob':
      return globFiles(input, cwd);
    default:
      return t('tools.unknownTool', { name });
  }
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function toAbs(p: string, cwd: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

function readFile(input: Record<string, unknown>): string {
  const p = toAbs(asString(input.file_path), process.cwd());
  if (!existsSync(p)) return t('tools.fileNotFound', { path: p });
  if (statSync(p).isDirectory()) return t('tools.isDirectory', { path: p });
  const content = readFileSync(p, 'utf8');
  const lines = content.split('\n');
  const offset = asNumber(input.offset) ?? 0;
  const limit = asNumber(input.limit) ?? lines.length;
  const slice = lines.slice(offset, offset + limit);
  const numbered = slice.map((l, i) => `${String(offset + i + 1).padStart(5, ' ')} │ ${l}`).join('\n');
  const total = lines.length;
  const header = t('tools.readHeader', {
    path: p,
    total,
    start: offset + 1,
    end: Math.min(offset + limit, total),
  });
  return `${header}\n${numbered}`;
}

function writeFile(input: Record<string, unknown>): string {
  const p = toAbs(asString(input.file_path), process.cwd());
  const content = asString(input.content);
  const dir = dirname(p);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content, 'utf8');
  return t('tools.wroteBytes', { bytes: Buffer.byteLength(content, 'utf8'), path: p });
}

function editFile(input: Record<string, unknown>): string {
  const p = toAbs(asString(input.file_path), process.cwd());
  const oldStr = asString(input.old_string);
  const newStr = asString(input.new_string);
  const replaceAll = input.replace_all === true;
  if (!existsSync(p)) return t('tools.fileNotFound', { path: p });
  const content = readFileSync(p, 'utf8');
  if (!oldStr) return t('tools.oldStringEmpty');

  const count = content.split(oldStr).length - 1;
  if (count === 0) return t('tools.oldStringNotFound', { path: p });
  if (count > 1 && !replaceAll) {
    const idx = content.indexOf(oldStr);
    const snippet = content.slice(Math.max(0, idx - 40), idx + oldStr.length + 40);
    return t('tools.oldStringMultiple', { count, snippet });
  }

  const next = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
  writeFileSync(p, next, 'utf8');
  return t('tools.replaced', { count: replaceAll ? count : 1, path: p });
}

async function runBash(input: Record<string, unknown>, cwd: string): Promise<string> {
  const command = asString(input.command);
  if (!command) return t('tools.commandEmpty');
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      shell: '/bin/bash',
    });
    return `[cwd: ${cwd}]\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}` || t('tools.noOutput');
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string; killed?: boolean };
    const out = [e.stdout, e.stderr ? `\n[stderr]\n${e.stderr}` : ''].filter(Boolean).join('\n');
    const killed = e.killed ? `\n${t('tools.commandTimeout')}` : '';
    return t('tools.commandExitCode', { code: e.code ?? '?', killed }) + `\n${out || e.message || ''}`;
  }
}

async function grepSearch(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = asString(input.pattern);
  if (!pattern) return t('tools.patternEmpty');
  const base = toAbs(asString(input.path) || cwd, cwd);
  const glob = asString(input.glob) || '**/*';
  let files: string[];
  if (existsSync(base) && !statSync(base).isDirectory()) {
    files = [base];
  } else {
    files = await fg(glob, { cwd: base, dot: false, onlyFiles: true, followSymbolicLinks: false });
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch (e) {
    return t('tools.invalidRegex', { pattern, error: (e as Error).message });
  }

  const out: string[] = [];
  const MAX_FILES = 500;
  const MAX_MATCHES = 300;
  let matches = 0;
  for (const f of files.slice(0, MAX_FILES)) {
    const abs = isAbsolute(f) ? f : join(base, f);
    try {
      const st = statSync(abs);
      if (st.size > 1_000_000) continue; // 跳过超大文件
      const content = readFileSync(abs, 'utf8');
      if (content.includes('\u0000')) continue; // 跳过二进制
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const rel = relative(cwd, abs);
          out.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
          if (++matches >= MAX_MATCHES) {
            out.push(t('tools.matchLimit', { max: MAX_MATCHES }));
            return out.join('\n');
          }
        }
      }
      regex.lastIndex = 0;
    } catch {
      // 忽略不可读文件
    }
  }
  return out.length ? out.join('\n') : t('tools.noMatches', { pattern });
}

async function globFiles(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = asString(input.pattern);
  if (!pattern) return t('tools.patternEmpty');
  const base = toAbs(asString(input.path) || cwd, cwd);
  const files = await fg(pattern, { cwd: base, dot: false, onlyFiles: false });
  if (!files.length) return t('tools.noMatches', { pattern });
  return files.map((f) => relative(cwd, isAbsolute(f) ? f : join(base, f))).slice(0, 500).join('\n');
}
