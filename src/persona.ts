/**
 * 丛雨人设（内置自 murasame-skill）
 * 《千恋＊万花》神刀「丛雨丸」之灵；真名绫；自称本座/吾辈，称用户为主人。
 * 台词与系统提示词已按语言本地化，具体内容见 src/locales/。
 */

import { getPersonaPrompt, getLines } from './i18n.js';
import type { LineGroup } from './i18n-types.js';

export type { LineGroup } from './i18n-types.js';

/** 当前语言的人设系统提示词。 */
export function personaPrompt(): string {
  return getPersonaPrompt();
}

/** 随机取一条台词。 */
export function pickLine(group: LineGroup): string {
  const arr = getLines(group);
  return arr[Math.floor(Math.random() * arr.length)];
}
