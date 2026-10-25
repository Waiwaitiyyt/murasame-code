/**
 * 丛雨（千恋＊万花）主题
 * 配色取自丛雨：淡紫长发、紫瞳、巫女装束，点缀樱花粉。
 */
import { homedir } from 'node:os';

export const VERSION = '0.1.0';

export const theme = {
  // 丛雨发色（浅薄荷绿）/ 主色
  mint: '#A8E4C8',
  // 酒红瞳 / 点缀
  wine: '#E07A9B',
  // 紫红飘带
  plum: '#C96A8E',
  // 深紫黑和风装 / 边框
  ink: '#7B6BA8',
  inkDeep: '#574883',
  // 巫女白 / 淡
  white: '#F5F1F7',
  // 状态色
  ok: '#7FD1A8',
  warn: '#E8C87F',
  err: '#FF7A93',
  // 次要文字
  dim: '#9A8FB0',
  dim2: '#6F6688',
} as const;

const RAW_LOGO: string[] = [
  '███╗   ███╗██╗   ██╗██████╗  █████╗ ███████╗ █████╗ ███╗   ███╗███████╗',
  '████╗ ████║██║   ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗████╗ ████║██╔════╝',
  '██╔████╔██║██║   ██║██████╔╝███████║███████╗███████║██╔████╔██║█████╗',
  '██║╚██╔╝██║██║   ██║██╔══██╗██╔══██║╚════██║██╔══██║██║╚██╔╝██║██╔══╝',
  '██║ ╚═╝ ██║╚██████╔╝██║  ██║██║  ██║███████║██║  ██║██║ ╚═╝ ██║███████╗',
  '╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝',
];

const LOGO_WIDTH = Math.max(...RAW_LOGO.map((l) => l.length));

/**
 * 左侧大标题：MURASAME（figlet ANSI Shadow 字体），模仿 Qwen Code 的 banner。
 * 每行 padEnd 到等宽，保证右侧信息框对齐。
 */
export const LOGO_LINES: string[] = RAW_LOGO.map((l) => l.padEnd(LOGO_WIDTH));

export interface InfoBoxOptions {
  provider: string;
  model: string;
  cwd: string;
}

const BOX_WIDTH = 58; // 信息框最大宽度（含左右边框）
const MIN_BOX_WIDTH = 30; // 信息框最小宽度（含左右边框）

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

/**
 * 右侧信息框（模仿 Qwen Code 的 ┌─┐ 框），6 行与 logo 对齐。
 * maxWidth 控制最大宽度（含边框），内容过长会被截断。
 */
export function buildInfoBox(opts: InfoBoxOptions, maxWidth: number = BOX_WIDTH): string[] {
  const width = Math.max(MIN_BOX_WIDTH, Math.min(BOX_WIDTH, maxWidth));
  const inner = width - 2; // 边框内宽度（─ 的数量）

  const providerName = opts.provider === 'claude' ? 'Claude' : 'OpenAI';
  const title = `>_ Murasame Code (v${VERSION})`;
  const conf = `${providerName} API Key | [${opts.provider}] ${opts.model}`;
  const rows = [title, '', conf, opts.cwd];

  const padRow = (s: string) => ' ' + clip(s, inner - 2).padEnd(inner - 2) + ' ';
  const border = (l: string, m: string, r: string) => l + m.repeat(inner) + r;

  return [
    border('┌', '─', '┐'),
    ...rows.map((r) => '│' + padRow(r) + '│'),
    border('└', '─', '┘'),
  ];
}

export type BannerMode = 'inline' | 'stacked' | 'box-only';

export interface BannerLayout {
  mode: BannerMode;
  logo: string[];
  box: string[];
}

/**
 * 根据终端宽度自适应 banner 布局：
 * - inline：宽度足够时，大字与信息框并排
 * - stacked：中等宽度时，大字在上、信息框在下
 * - box-only：过窄时只显示信息框（宽度自适应）
 */
export function buildBanner(opts: InfoBoxOptions, columns?: number): BannerLayout {
  const cols = columns && columns > 0 ? columns : 80;
  const boxMax = Math.max(MIN_BOX_WIDTH, Math.min(BOX_WIDTH, cols - 2));
  const box = buildInfoBox(opts, boxMax);

  if (cols >= LOGO_WIDTH + 2 + box[0].length) return { mode: 'inline', logo: LOGO_LINES, box };
  if (cols >= LOGO_WIDTH + 2) return { mode: 'stacked', logo: LOGO_LINES, box };
  return { mode: 'box-only', logo: [], box };
}

/** 把 home 目录缩写成 ~ */
export function formatCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length);
  return cwd;
}
