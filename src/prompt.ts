import { personaPrompt } from './persona.js';
import { t } from './i18n.js';

export function buildSystemPrompt(cwd: string): string {
  const shellGuide = process.platform === 'win32' ? `\n\n${t('windowsShellGuide')}` : '';
  return `${personaPrompt()}\n\n${t('promptGuide', { cwd })}${shellGuide}`;
}
