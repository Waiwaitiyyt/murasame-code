import { t } from './i18n.js';

export function describeError(error: unknown): string {
  const e = error as { status?: number; message?: string };
  const message = e?.message ?? String(error);
  if (e?.status === 429) return `${t('run.rateLimited')} ${message}`;
  if (e?.status === 401 || e?.status === 403) return `${t('run.authFailed')} ${message}`;
  if (typeof e?.status === 'number' && e.status >= 500) {
    return `${t('run.serverUnavailable')} ${message}`;
  }
  return message;
}
