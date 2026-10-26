import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Config, ProviderName } from './config.js';

// ---------------------------------------------------------------------------
// 归一化类型（同时适配 Claude Messages API 与 OpenAI Chat Completions API）
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type NonSystemMessage = Exclude<ChatMessage, { role: 'system' }>;

export interface StreamHooks {
  onTextDelta?: (delta: string) => void;
  onToolCallStart?: (call: ToolCall) => void;
}

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMClient {
  provider: ProviderName;
  stream(
    messages: ChatMessage[],
    tools: ToolDef[],
    hooks: StreamHooks,
    signal: AbortSignal,
  ): Promise<StreamResult>;
}

const MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Claude（Anthropic Messages API）
// ---------------------------------------------------------------------------

class ClaudeClient implements LLMClient {
  provider = 'claude' as const;
  private client: Anthropic;
  private model: string;
  private cacheSupported = true;

  constructor(cfg: Config) {
    this.client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, maxRetries: 2 });
    this.model = cfg.model;
  }

  async stream(
    messages: ChatMessage[],
    tools: ToolDef[],
    hooks: StreamHooks,
    signal: AbortSignal,
  ): Promise<StreamResult> {
    const system = messages
      .filter((m): m is Extract<ChatMessage, { role: 'system' }> => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const anthropicMessages = toAnthropicMessages(
      messages.filter((m): m is NonSystemMessage => m.role !== 'system'),
    );

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const request = async (cached: boolean): Promise<StreamResult> => {
      // 断点放在稳定的 system 末尾，工具定义也包含在其缓存前缀中。
      const cachedSystem = [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }];
      const realStream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: cached ? cachedSystem : system,
          messages: anthropicMessages,
          ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        },
        { signal },
      );

      let text = '';
      const toolCalls: ToolCall[] = [];
      realStream.on('text', (delta) => {
        text += delta;
        hooks.onTextDelta?.(delta);
      });
      const final = await realStream.finalMessage();
      for (const block of final.content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      const usage = final.usage as typeof final.usage & {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      return {
        text,
        toolCalls,
        usage: {
          inputTokens: usage.input_tokens
            + (usage.cache_creation_input_tokens ?? 0)
            + (usage.cache_read_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
        },
      };
    };

    const cached = this.cacheSupported && Boolean(system);
    try {
      return await request(cached);
    } catch (error) {
      const e = error as { status?: number };
      if (cached && e.status === 400) {
        this.cacheSupported = false;
        return request(false);
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI 兼容（Chat Completions API）
// ---------------------------------------------------------------------------

class OpenAIClient implements LLMClient {
  provider = 'openai' as const;
  private client: OpenAI;
  private model: string;
  private includeUsage: boolean;

  constructor(cfg: Config) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, maxRetries: 2 });
    this.model = cfg.model;
    this.includeUsage = new URL(cfg.baseUrl).hostname === 'api.openai.com';
  }

  async stream(
    messages: ChatMessage[],
    tools: ToolDef[],
    hooks: StreamHooks,
    signal: AbortSignal,
  ): Promise<StreamResult> {
    const openaiMessages = messages.map(toOpenAIMessage);
    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: openaiMessages,
        ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
        stream: true,
        ...(this.includeUsage ? { stream_options: { include_usage: true } } : {}),
        max_tokens: MAX_TOKENS,
      },
      { signal },
    );

    let text = '';
    let usage: StreamResult['usage'];
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        hooks.onTextDelta?.(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let cur = toolCallsMap.get(idx);
          if (!cur) {
            cur = { id: '', name: '', args: '' };
            toolCallsMap.set(idx, cur);
          }
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }
    }

    const toolCalls: ToolCall[] = [...toolCallsMap.values()].map((tc) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
      name: tc.name,
      input: safeParse(tc.args),
    }));

    return { text, toolCalls, usage };
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export function createClient(cfg: Config): LLMClient {
  if (cfg.provider === 'claude') return new ClaudeClient(cfg);
  return new OpenAIClient(cfg);
}

// ---------------------------------------------------------------------------
// 消息格式转换
// ---------------------------------------------------------------------------

function toAnthropicMessage(m: NonSystemMessage): Anthropic.MessageParam {
  switch (m.role) {
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant': {
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      return { role: 'assistant', content: blocks };
    }
    case 'tool': {
      const result: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      return { role: 'user', content: [result] };
    }
  }
}

/**
 * 转换到 Anthropic 格式时，把连续的 tool 结果合并进同一个 user 消息。
 * Claude API 要求：一次 assistant 消息的所有 tool_use，其 tool_result 必须紧跟并聚合在一个 user 消息内。
 */
function toAnthropicMessages(messages: NonSystemMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const result: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const last = out[out.length - 1];
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        last.content[0]?.type === 'tool_result'
      ) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(result);
      } else {
        out.push({ role: 'user', content: [result] });
      }
    } else {
      out.push(toAnthropicMessage(m));
    }
  }
  return out;
}

export function toOpenAIMessage(m: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content };
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant': {
      const message: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content || null,
      };
      if (m.toolCalls.length > 0) {
        message.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      return message;
    }
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
}

function safeParse(s: string): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
