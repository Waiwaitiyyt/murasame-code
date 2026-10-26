import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';
import fg from 'fast-glob';
import type { ToolDef } from './llm.js';
import { t } from './i18n.js';

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
  signal?: AbortSignal,
): Promise<string> {
  switch (name) {
    case 'read_file':
      return readFile(input, cwd);
    case 'write_file':
      return writeFile(input, cwd);
    case 'edit':
      return editFile(input, cwd);
    case 'bash':
      return runBash(input, cwd, signal);
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

/** shell 无法完整静态解析；对常见破坏性命令保守地要求交互确认。 */
export function requiresCommandApproval(command: string): boolean {
  return /\b(?:rm|rmdir|unlink|shred|mkfs|sudo)\s+\S/i.test(command)
    || /\bgit\s+(?:reset\s+--hard|clean\s+-\S*?[fd]|push\s+--force)/i.test(command)
    || /\b(?:chmod|chown)\s+-R\b/i.test(command)
    || /\bdd\s+[^\n]*\bof=\/dev\//i.test(command)
    || /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash)\b/i.test(command);
}

function diffPreview(before: string, after: string): string {
  if (before === after) return '';
  const oldLines = before ? before.split('\n') : [];
  const newLines = after ? after.split('\n') : [];
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const removed = oldLines.slice(start, oldEnd);
  const added = newLines.slice(start, newEnd);
  const shown = [...removed.map((line) => `- ${line}`), ...added.map((line) => `+ ${line}`)];
  const maxLines = 24;
  const preview = shown.slice(0, maxLines).map((line) =>
    line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '…' : line,
  );
  if (shown.length > maxLines) preview.push(`… (${shown.length - maxLines} more lines)`);
  return `@@ line ${start + 1} @@\n${preview.join('\n')}`;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 超过 5MB 直接拒绝，避免撑爆上下文
const MAX_READ_LINES = 2000; // 未指定 limit 时默认最多读的行数
const MAX_LINE_LENGTH = 2000; // 单行超长时截断，避免压缩后的 bundle 撑爆上下文

function readFile(input: Record<string, unknown>, cwd: string): string {
  const p = toAbs(asString(input.file_path), cwd);
  if (!existsSync(p)) return t('tools.fileNotFound', { path: p });
  const st = statSync(p);
  if (st.isDirectory()) return t('tools.isDirectory', { path: p });
  if (st.size > MAX_FILE_BYTES) return t('tools.fileTooLarge', { path: p });
  const content = readFileSync(p, 'utf8');
  const lines = content.split('\n');
  const offset = Math.max(0, Math.floor(asNumber(input.offset) ?? 0));
  const limit = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(asNumber(input.limit) ?? MAX_READ_LINES)));
  const slice = lines.slice(offset, offset + limit);
  const numbered = slice
    .map((l, i) => {
      const line = l.length > MAX_LINE_LENGTH ? l.slice(0, MAX_LINE_LENGTH) + '…' : l;
      return `${String(offset + i + 1).padStart(5, ' ')} │ ${line}`;
    })
    .join('\n');
  const total = lines.length;
  const header = t('tools.readHeader', {
    path: p,
    total,
    start: offset + 1,
    end: Math.min(offset + limit, total),
  });
  return `${header}\n${numbered}`;
}

function writeFile(input: Record<string, unknown>, cwd: string): string {
  const p = toAbs(asString(input.file_path), cwd);
  const content = asString(input.content);
  const before = existsSync(p) && statSync(p).size <= MAX_FILE_BYTES ? readFileSync(p, 'utf8') : '';
  const dir = dirname(p);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content, 'utf8');
  return `${t('tools.wroteBytes', { bytes: Buffer.byteLength(content, 'utf8'), path: p })}\n${diffPreview(before, content)}`;
}

function editFile(input: Record<string, unknown>, cwd: string): string {
  const p = toAbs(asString(input.file_path), cwd);
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

  const next = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, () => newStr);
  writeFileSync(p, next, 'utf8');
  return `${t('tools.replaced', { count: replaceAll ? count : 1, path: p })}\n${diffPreview(content, next)}`;
}

async function runBash(input: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<string> {
  const command = asString(input.command);
  if (!command) return t('tools.commandEmpty');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let timedOut = false;
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('/bin/bash', ['-c', command], {
        cwd,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let tooLarge = false;
      const kill = () => {
        if (child.pid && process.platform !== 'win32') {
          try {
            process.kill(-child.pid, 'SIGKILL');
            return;
          } catch {
            // 进程组已退出时尝试终止 shell 本身
          }
        }
        child.kill('SIGKILL');
      };
      const onAbort = () => kill();
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, 120_000);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          tooLarge = true;
          kill();
          return;
        }
        if (stream === 'stdout') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      };
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
      child.on('error', (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (code === 0 && !tooLarge && !timedOut) resolve({ stdout, stderr });
        else reject({ code, stdout, stderr, message: tooLarge ? 'Command output exceeded 8MB' : '' });
      });
    });
    const out = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`;
    if (!out.trim()) return t('tools.noOutput');
    return `[cwd: ${cwd}]\n${out}`;
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string; killed?: boolean };
    const out = [e.stdout, e.stderr ? `\n[stderr]\n${e.stderr}` : ''].filter(Boolean).join('\n');
    const killed = timedOut ? `\n${t('tools.commandTimeout')}` : '';
    return t('tools.commandExitCode', { code: e.code ?? '?', killed }) + `\n${out || e.message || ''}`;
  }
}

async function grepSearch(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = asString(input.pattern);
  if (!pattern) return t('tools.patternEmpty');
  const base = toAbs(asString(input.path) || cwd, cwd);
  const glob = asString(input.glob) || '**/*';
  const ignore = input.path || input.glob
    ? ['**/node_modules/**', '**/.git/**']
    : ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**', '**/.cache/**'];
  let files: string[];
  if (existsSync(base) && !statSync(base).isDirectory()) {
    files = [base];
  } else {
    files = await fg(glob, {
      cwd: base,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore,
    });
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
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
  const files = await fg(pattern, {
    cwd: base,
    dot: false,
    onlyFiles: false,
    ignore: input.path ? ['**/node_modules/**', '**/.git/**'] : ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**', '**/.cache/**'],
  });
  if (!files.length) return t('tools.noMatches', { pattern });
  return files.map((f) => relative(cwd, isAbsolute(f) ? f : join(base, f))).slice(0, 500).join('\n');
}
