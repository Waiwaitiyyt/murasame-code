import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_LANGUAGE, isLanguage, type Language } from './i18n-types.js';

export type ProviderName = 'claude' | 'openai';

export interface Config {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
  language: Language;
}

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  claude: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
};

export const DEFAULT_BASE_URLS: Record<ProviderName, string> = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

const CONFIG_DIR = join(homedir(), '.murasame');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function readConfigFile(): Partial<Config> | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function writeConfigFile(cfg: Partial<Config>): void {
  ensureDir();
  const merged = { ...readConfigFile(), ...cfg };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}

export function configFilePath(): string {
  return CONFIG_FILE;
}

/**
 * 解析语言。优先级：传入覆盖 > 环境变量 MURASAME_LANG > 配置文件 > 默认值（zh）。
 */
export function resolveLanguage(override?: string): Language {
  if (override && isLanguage(override)) return override;
  const env = process.env.MURASAME_LANG;
  if (env && isLanguage(env)) return env;
  const file = readConfigFile();
  if (file?.language && isLanguage(file.language)) return file.language;
  return DEFAULT_LANGUAGE;
}

/**
 * 解析最终配置。优先级：传入覆盖 > 环境变量 > 配置文件 > 默认值。
 */
export function resolveConfig(overrides: Partial<Config> = {}): Config {
  const file = readConfigFile() ?? {};

  const env = process.env;
  const envProvider =
    env.MURASAME_PROVIDER === 'claude' || env.MURASAME_PROVIDER === 'openai'
      ? (env.MURASAME_PROVIDER as ProviderName)
      : undefined;

  const provider: ProviderName =
    overrides.provider ?? envProvider ?? file.provider ?? 'claude';

  const apiKey =
    overrides.apiKey ??
    env.MURASAME_API_KEY ??
    (provider === 'claude' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ??
    file.apiKey ??
    '';

  const model =
    overrides.model ?? env.MURASAME_MODEL ?? file.model ?? DEFAULT_MODELS[provider];

  const baseUrl =
    overrides.baseUrl ??
    env.MURASAME_BASE_URL ??
    file.baseUrl ??
    DEFAULT_BASE_URLS[provider];

  const language = resolveLanguage(overrides.language);

  return { provider, apiKey, model, baseUrl, language };
}

// ---------------------------------------------------------------------------
// 厂商预置（大厂）：选择厂商后自动带出 base URL 与默认模型，并可请求模型列表。
// provider 仍归一化到 claude / openai 两种接口，不影响 llm/ui 的现有逻辑。
// ---------------------------------------------------------------------------

export interface Vendor {
  id: string;
  name: string;
  provider: ProviderName;
  baseUrl: string;
  defaultModel: string;
  keyHint: string;
}

export const VENDORS: Vendor[] = [
  {
    id: 'anthropic',
    name: 'Anthropic（Claude）',
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    keyHint: 'Anthropic API Key（sk-ant-...）',
  },
  {
    id: 'openai',
    name: 'OpenAI（GPT）',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    keyHint: 'OpenAI API Key（sk-...）',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    keyHint: 'DeepSeek API Key（sk-...）',
  },
  {
    id: 'zhipu',
    name: '智谱 AI（GLM）',
    provider: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    keyHint: '智谱 API Key（id.secret）',
  },
  {
    id: 'moonshot',
    name: 'Moonshot（Kimi）',
    provider: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    keyHint: 'Moonshot API Key（sk-...）',
  },
  {
    id: 'qwen',
    name: '通义千问（DashScope）',
    provider: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    keyHint: 'DashScope API Key（sk-...）',
  },
];

/** 请求厂商的模型列表（OpenAI 兼容 /models 或 Anthropic /v1/models）。失败时抛出异常。 */
export async function fetchModels(vendor: Vendor, apiKey: string): Promise<string[]> {
  const url =
    vendor.provider === 'claude'
      ? `${vendor.baseUrl}/v1/models`
      : `${vendor.baseUrl}/models`;
  const headers: Record<string, string> =
    vendor.provider === 'claude'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
  } finally {
    clearTimeout(timer);
  }
}
