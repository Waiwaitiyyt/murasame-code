import { relative, isAbsolute } from 'node:path';
import type { ChatMessage, LLMClient, ToolCall } from './llm.js';
import { getToolDefs, executeTool } from './tools.js';
import { buildSystemPrompt } from './prompt.js';
import { t } from './i18n.js';

export interface AgentHooks {
  /** 一次模型调用完成，seconds 为本次思考耗时 */
  onThinking?: (seconds: number) => void;
  /** 模型在调用工具前输出的行动标题（一句话意图） */
  onActionTitle?: (text: string) => void;
  /** 最终回答（本次不再调用工具） */
  onText?: (text: string) => void;
  /** 工具执行完成，result 为完整结果文本 */
  onToolResult?: (call: ToolCall, ok: boolean, result: string) => void;
}

const MAX_ITERATIONS = 40;

/** 工具名 → 本地化标签（用于 Qwen Code 风格输出） */
export function toolLabel(name: string): string {
  const label = t(`tools.labels.${name}`);
  return label === `tools.labels.${name}` ? name : label;
}

/** 提取工具的目标路径 / 命令 / 模式，用于 `✓ 编辑 <file>` 这类显示 */
export function toolTarget(call: ToolCall, cwd: string): string {
  const input = call.input as Record<string, unknown>;
  if (call.name === 'bash') {
    const cmd = input.command;
    return typeof cmd === 'string' ? cmd : '';
  }
  if (call.name === 'glob' || call.name === 'grep_search') {
    const pattern = input.pattern;
    return typeof pattern === 'string' ? pattern : '';
  }
  const p = input.file_path ?? input.path;
  if (typeof p === 'string') {
    return isAbsolute(p) ? relative(cwd, p) : p;
  }
  return '';
}

/**
 * 持久化的对话历史（归一化消息），跨轮次复用。
 */
export type Conversation = ChatMessage[];

export function newConversation(cwd: string): Conversation {
  return [{ role: 'system', content: buildSystemPrompt(cwd) }];
}

/**
 * 运行一轮 agent 循环：把 user 文本加入对话，反复调用模型 + 执行工具，直到模型不再请求工具。
 * 返回最终文本，并原地更新 conversation。
 */
export async function runTurn(
  client: LLMClient,
  conversation: Conversation,
  userText: string,
  hooks: AgentHooks,
  signal: AbortSignal,
  cwd: string,
): Promise<string> {
  conversation.push({ role: 'user', content: userText });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const start = Date.now();
    const { text, toolCalls } = await client.stream(conversation, getToolDefs(), {}, signal);
    const seconds = (Date.now() - start) / 1000;

    hooks.onThinking?.(seconds);

    if (toolCalls.length === 0) {
      conversation.push({ role: 'assistant', content: text, toolCalls: [] });
      if (text) hooks.onText?.(text);
      return text;
    }

    if (text) hooks.onActionTitle?.(text);

    // 记录本次 assistant 消息（含工具调用）
    conversation.push({ role: 'assistant', content: text, toolCalls });

    for (const call of toolCalls) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let result: string;
      let ok = true;
      try {
        result = await executeTool(call.name, call.input, cwd);
      } catch (e) {
        ok = false;
        result = t('agent.toolExecError', { error: (e as Error).message });
      }
      hooks.onToolResult?.(call, ok, result);
      conversation.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
    }
  }

  const maxed = t('agent.maxIterations');
  conversation.push({ role: 'assistant', content: maxed, toolCalls: [] });
  hooks.onText?.(maxed);
  return maxed;
}
