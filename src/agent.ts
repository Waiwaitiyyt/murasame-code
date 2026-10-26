import { relative, isAbsolute } from 'node:path';
import type { ChatMessage, LLMClient, ToolCall } from './llm.js';
import { getToolDefs, executeTool } from './tools.js';
import { PermissionManager, type PermissionChoice } from './permissions.js';
import { buildSystemPrompt } from './prompt.js';
import { t } from './i18n.js';

export interface AgentHooks {
  /** 一次模型调用完成，seconds 为本次思考耗时 */
  onThinking?: (seconds: number) => void;
  /** 模型在调用工具前输出的行动标题（一句话意图） */
  onActionTitle?: (text: string) => void;
  /** 最终回答（本次不再调用工具） */
  onText?: (text: string) => void;
  /** 最终回答的流式增量（逐段输出，用于实时渲染） */
  onTextDelta?: (delta: string) => void;
  /** 工具执行完成，result 为完整结果文本 */
  onToolResult?: (call: ToolCall, ok: boolean, result: string) => void;
  onUsage?: (inputTokens: number, outputTokens: number) => void;
  confirmTool?: (call: ToolCall) => Promise<PermissionChoice>;
}

const MAX_ITERATIONS = 40;
const MAX_HISTORY_MESSAGES = 80; // 保留 system + 最近消息，超长时裁剪，防止撞上下文上限

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
 * 就地裁剪对话历史：保留 system（index 0）与最近消息，防止只增不减撞上下文上限。
 * 只在「user（纯文本）消息」边界处裁剪，确保 assistant 的 tool_use 与其 tool 结果不被拆散。
 */
export function trimConversation(conversation: Conversation, max = MAX_HISTORY_MESSAGES): void {
  if (conversation.length <= max) return;
  const rest = conversation.slice(1);
  const keep = max - 1;
  if (rest.length <= keep) return;

  const target = rest.length - keep;
  let cut = -1;
  for (let i = target; i < rest.length; i++) {
    if (rest[i].role === 'user') {
      cut = i;
      break;
    }
  }
  if (cut < 0) {
    for (let i = target - 1; i >= 0; i--) {
      if (rest[i].role === 'user') {
        cut = i;
        break;
      }
    }
  }
  if (cut <= 0) return; // 单轮工具调用过长时不能拆开 tool_use / tool_result
  conversation.splice(1, cut);
}

/** 用模型把旧对话压成一条摘要，保留后续轮次需要的背景。 */
export async function compactConversation(
  client: LLMClient,
  conversation: Conversation,
  signal: AbortSignal,
): Promise<{ usage?: { inputTokens: number; outputTokens: number } }> {
  if (conversation.length <= 1) return {};
  const history = conversation.slice(1).map((message) => {
    if (message.role === 'tool') return `tool ${message.name}: ${message.content.slice(0, 2000)}`;
    if (message.role === 'assistant') {
      const calls = message.toolCalls.map((call) => `${call.name}(${JSON.stringify(call.input).slice(0, 500)})`).join(', ');
      return `assistant: ${message.content.slice(0, 4000)}${calls ? `\ntools: ${calls}` : ''}`;
    }
    return `user: ${message.content.slice(0, 4000)}`;
  }).join('\n\n');
  const context = history.length > 80_000
    ? history.slice(0, 10_000) + '\n[older details omitted]\n' + history.slice(-70_000)
    : history;
  const result = await client.stream([
    { role: 'system', content: 'Summarize this coding-agent conversation in the same language as the user. Preserve user requirements, decisions, file changes, unresolved problems, and important tool results. Be concise and factual.' },
    { role: 'user', content: context },
  ], [], {}, signal);
  const summary = result.text.trim();
  if (!summary) throw new Error('Could not summarize the conversation');
  conversation.splice(1, conversation.length - 1, {
    role: 'user',
    content: `Previous conversation summary:\n${summary}`,
  });
  return { usage: result.usage };
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
  permissions: PermissionManager = new PermissionManager(),
): Promise<string> {
  trimConversation(conversation);
  conversation.push({ role: 'user', content: userText });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const start = Date.now();
      const { text, toolCalls, usage } = await client.stream(
        conversation,
        getToolDefs(),
        { onTextDelta: hooks.onTextDelta },
        signal,
      );
      const seconds = (Date.now() - start) / 1000;

      hooks.onThinking?.(seconds);
      if (usage) hooks.onUsage?.(usage.inputTokens, usage.outputTokens);

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
          if (permissions.needsApproval(call)) {
            const choice = await hooks.confirmTool?.(call) ?? 'no';
            const approved = permissions.accept(call, choice);
            if (!approved) {
              ok = false;
              result = t('agent.commandApprovalRequired');
            } else {
              if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
              result = await executeTool(call.name, call.input, cwd, signal);
            }
          } else {
            result = await executeTool(call.name, call.input, cwd, signal);
          }
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
  } catch (error) {
    // 中止发生在多个工具调用之间时，补齐尚未返回的结果，避免下一轮 API 拒绝历史。
    const lastAssistant = [...conversation].reverse().findIndex((message) => message.role === 'assistant');
    if (lastAssistant >= 0) {
      const index = conversation.length - 1 - lastAssistant;
      const message = conversation[index];
      if (message.role === 'assistant' && message.toolCalls.length > 0) {
        const returned = new Set(conversation.slice(index + 1)
          .filter((item): item is Extract<ChatMessage, { role: 'tool' }> => item.role === 'tool')
          .map((item) => item.toolCallId));
        for (const call of message.toolCalls) {
          if (!returned.has(call.id)) {
            conversation.push({
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: t('agent.toolCancelled'),
            });
          }
        }
      }
    }
    throw error;
  }
}
