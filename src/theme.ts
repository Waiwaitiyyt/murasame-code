/**
 * 丛雨（千恋＊万花）主题
 * 配色取自丛雨：浅薄荷绿超长直发、酒红瞳、深紫黑和风装，点缀紫红飘带与樱花粉。
 */
import { homedir } from 'node:os';
import sliceAnsi from 'slice-ansi';
import stringWidth from 'string-width';

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

const COMPACT_GLYPHS: Record<string, string[]> = {
  M: ['█ █', '███', '███', '█ █', '█ █'],
  U: ['█ █', '█ █', '█ █', '█ █', '███'],
  R: ['██ ', '█ █', '██ ', '█ █', '█ █'],
  A: ['███', '█ █', '███', '█ █', '█ █'],
  S: ['███', '█  ', '███', '  █', '███'],
  E: ['███', '█  ', '██ ', '█  ', '███'],
};
const COMPACT_LOGO = Array.from({ length: 5 }, (_, row) =>
  [...'MURASAME'].map((letter) => COMPACT_GLYPHS[letter][row]).join(' '),
);
const COMPACT_WIDTH = Math.max(...COMPACT_LOGO.map((line) => line.length));
const PLAIN_LOGO = ['MURASAME'];

export interface InfoBoxOptions {
  provider: string;
  model: string;
  cwd: string;
}

const BOX_WIDTH = 58; // 信息框最大宽度（含左右边框）
const MIN_BOX_WIDTH = 8; // 极窄终端也不能超过可用宽度

function clip(s: string, max: number): string {
  if (stringWidth(s) <= max) return s;
  const suffix = max > 3 ? '...' : '';
  const available = max - suffix.length;
  let end = available;
  let clipped = sliceAnsi(s, 0, end);
  while (stringWidth(clipped) > available && end > 0) {
    clipped = sliceAnsi(s, 0, --end);
  }
  return clipped + suffix;
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

  const padRow = (s: string) => {
    const clipped = clip(s, inner - 2);
    return ' ' + clipped + ' '.repeat(inner - 2 - stringWidth(clipped)) + ' ';
  };
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
 * - stacked：根据宽度选大字、紧凑字或纯文本，放在信息框上方
 * - box-only：极窄时只显示信息框
 */
export function buildBanner(opts: InfoBoxOptions, columns?: number): BannerLayout {
  const cols = columns && columns > 0 ? Math.floor(columns) : 80;
  const available = Math.max(0, cols - 2); // 给终端自动换行留出余量
  if (available < MIN_BOX_WIDTH) {
    return { mode: 'box-only', logo: [], box: [clip('MURASAME', available)] };
  }
  const boxMax = Math.min(BOX_WIDTH, available);
  const box = buildInfoBox(opts, boxMax);

  if (available >= LOGO_WIDTH + 2 + box[0].length) {
    return { mode: 'inline', logo: LOGO_LINES, box };
  }
  if (available >= LOGO_WIDTH) return { mode: 'stacked', logo: LOGO_LINES, box };
  if (available >= COMPACT_WIDTH) return { mode: 'stacked', logo: COMPACT_LOGO, box };
  if (available >= PLAIN_LOGO[0].length) return { mode: 'stacked', logo: PLAIN_LOGO, box };
  return { mode: 'box-only', logo: [], box };
}

/** 把 home 目录缩写成 ~ */
export function formatCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length);
  return cwd;
}
