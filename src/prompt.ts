import { personaPrompt } from './persona.js';
import { t } from './i18n.js';

export function buildSystemPrompt(cwd: string): string {
  return `${personaPrompt()}\n\n${t('promptGuide', { cwd })}`;
}
