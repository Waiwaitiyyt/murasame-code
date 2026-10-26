import { createHash } from 'node:crypto';
import type { ToolCall } from './llm.js';
import type { Config, PermissionMode } from './config.js';
import { requiresCommandApproval } from './tools.js';

export type PermissionChoice = 'yes' | 'no' | 'always';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

/** 对同一工具及输入生成稳定指纹；配置文件不会保存命令或文件内容原文。 */
export function actionFingerprint(call: ToolCall, cwd: string = process.cwd()): string {
  const input = call.name === 'bash' ? { command: call.input.command } : stableValue(call.input);
  return createHash('sha256').update(JSON.stringify([cwd, call.name, input])).digest('hex');
}

export class PermissionManager {
  private mode: PermissionMode;
  private approved: Set<string>;
  private save?: (patch: Partial<Config>) => void;
  private cwd: string;

  constructor(
    mode: PermissionMode = 'auto',
    approvedActions: string[] = [],
    save?: (patch: Partial<Config>) => void,
    cwd: string = process.cwd(),
  ) {
    this.mode = mode;
    this.approved = new Set(approvedActions);
    this.save = save;
    this.cwd = cwd;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.save?.({ permissionMode: mode });
    this.mode = mode;
  }

  clearRemembered(): void {
    this.save?.({ approvedActions: [] });
    this.approved.clear();
  }

  rememberedCount(): number {
    return this.approved.size;
  }

  needsApproval(call: ToolCall): boolean {
    if (this.mode === 'full-access') return false;
    if (this.approved.has(actionFingerprint(call, this.cwd))) return false;
    if (this.mode === 'manual') return true;
    return call.name === 'bash' && requiresCommandApproval(String(call.input.command ?? ''));
  }

  accept(call: ToolCall, choice: PermissionChoice): boolean {
    if (choice === 'no') return false;
    if (choice === 'always') {
      const next = new Set(this.approved);
      next.add(actionFingerprint(call, this.cwd));
      const actions = [...next].slice(-500);
      this.save?.({ approvedActions: actions });
      this.approved = new Set(actions);
    }
    return true;
  }
}
