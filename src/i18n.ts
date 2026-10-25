import { zh } from './locales/zh.js';
import { en } from './locales/en.js';
import { ja } from './locales/ja.js';
import {
  DEFAULT_LANGUAGE,
  type Language,
  type LineGroup,
  type PersonaLines,
} from './i18n-types.js';

export { DEFAULT_LANGUAGE, LANGUAGES, isLanguage } from './i18n-types.js';
export type { Language, LineGroup, LocaleMessages } from './i18n-types.js';

const MESSAGES = { zh, en, ja } as const;

let current: Language = DEFAULT_LANGUAGE;

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

/** 深路径取值（a.b.c），不存在返回 undefined。 */
function lookup(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** 取当前语言的文案，并用 vars 做 `{key}` 插值。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(MESSAGES[current], key);
  const str = typeof raw === 'string' ? raw : (raw ?? key).toString();
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`,
  );
}

/** 取当前语言的台词库。 */
export function getPersonaLines(): PersonaLines {
  return MESSAGES[current].persona.lines;
}

/** 取当前语言的台词组。 */
export function getLines(group: LineGroup): string[] {
  return MESSAGES[current].persona.lines[group];
}

/** 取当前语言的人设系统提示词。 */
export function getPersonaPrompt(): string {
  return MESSAGES[current].persona.prompt;
}
