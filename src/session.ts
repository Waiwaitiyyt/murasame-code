import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { newConversation, type Conversation } from './agent.js';
import type { ChatMessage } from './llm.js';

const defaultDirectory = join(homedir(), '.murasame', 'sessions');

export function sessionFilePath(cwd: string, directory = defaultDirectory): string {
  const key = createHash('sha256').update(resolve(cwd)).digest('hex');
  return join(directory, `${key}.json`);
}

function validMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (typeof message.content !== 'string') return false;
  if (message.role === 'user') return true;
  if (message.role === 'assistant') {
    return Array.isArray(message.toolCalls) && message.toolCalls.every((call: unknown) => {
      if (!call || typeof call !== 'object') return false;
      const tool = call as Record<string, unknown>;
      return typeof tool.id === 'string' && typeof tool.name === 'string'
        && !!tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input);
    });
  }
  return message.role === 'tool' && typeof message.toolCallId === 'string' && typeof message.name === 'string';
}

export function loadSession(cwd: string, directory = defaultDirectory): Conversation {
  const fresh = newConversation(cwd);
  const file = sessionFilePath(cwd, directory);
  if (!existsSync(file)) return fresh;
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; cwd?: unknown; messages?: unknown };
  if (saved.version !== 1 || saved.cwd !== resolve(cwd) || !Array.isArray(saved.messages)
    || !saved.messages.every(validMessage)) {
    throw new Error(`会话文件格式无效：${file}`);
  }
  const messages = saved.messages as Exclude<ChatMessage, { role: 'system' }>[];
  const repaired: Conversation = [...fresh];
  let pending = new Map<string, string>();
  const finishPending = () => {
    for (const [toolCallId, name] of pending) {
      repaired.push({ role: 'tool', toolCallId, name, content: '上次会话中断，工具结果未保存。' });
    }
    pending = new Map();
  };
  for (const message of messages) {
    if (message.role !== 'tool') finishPending();
    repaired.push(message);
    if (message.role === 'assistant') {
      pending = new Map(message.toolCalls.map((call) => [call.id, call.name]));
    } else if (message.role === 'tool') {
      pending.delete(message.toolCallId);
    }
  }
  finishPending();
  return repaired;
}

export function saveSession(cwd: string, conversation: Conversation, directory = defaultDirectory): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = sessionFilePath(cwd, directory);
  const temp = `${file}.${process.pid}.tmp`;
  const data = { version: 1, cwd: resolve(cwd), messages: conversation.filter((message) => message.role !== 'system') };
  try {
    writeFileSync(temp, JSON.stringify(data) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* no temporary file */ }
    throw error;
  }
}

export function clearSession(cwd: string, directory = defaultDirectory): void {
  try { unlinkSync(sessionFilePath(cwd, directory)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
