import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from './llm.js';
import {
  resolveConfig,
  resolveLanguage,
  writeConfigFile,
  configFilePath,
  VENDORS,
  fetchModels,
  type ProviderName,
  type Config,
  type Vendor,
} from './config.js';
import { runTurn, newConversation, type Conversation, toolLabel, toolTarget } from './agent.js';
import { runInteractive } from './ui.js';
import { theme, buildBanner, formatCwd, VERSION } from './theme.js';
import { pickLine } from './persona.js';
import { t, setLanguage } from './i18n.js';

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

interface CliOptions {
  help: boolean;
  version: boolean;
  configure: boolean;
  print: boolean;
  setKey?: string;
  provider?: ProviderName;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  lang?: string;
  prompt?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { help: false, version: false, configure: false, print: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '--configure':
        opts.configure = true;
        break;
      case '-p':
      case '--print':
        opts.print = true;
        break;
      case '--set-key':
        opts.setKey = argv[++i];
        break;
      case '--provider':
        opts.provider = argv[++i] as ProviderName;
        break;
      case '--model':
        opts.model = argv[++i];
        break;
      case '--base-url':
        opts.baseUrl = argv[++i];
        break;
      case '--api-key':
        opts.apiKey = argv[++i];
        break;
      case '--lang':
        opts.lang = argv[++i];
        break;
      default:
        if (a.startsWith('-')) {
          // 未知 flag：忽略并提示
          process.stderr.write(t('args.unknownFlag', { flag: a }) + '\n');
        } else {
          positional.push(a);
        }
    }
  }

  if (positional.length) opts.prompt = positional.join(' ');
  return opts;
}

// ---------------------------------------------------------------------------
// 彩色输出（one-shot / 命令行提示用）
// ---------------------------------------------------------------------------

function colorize(text: string, hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\u001b[38;2;${r};${g};${b}m${text}\u001b[0m`;
}

const MAX_TOOL_RESULT_LINES = 20;

/** print 模式：把 logo + 信息框自适应渲染到 stderr（含颜色） */
function renderTitle(config: Config, cwd: string): void {
  const { mode, logo, box } = buildBanner(
    {
      provider: config.provider,
      model: config.model,
      cwd: formatCwd(cwd),
    },
    process.stdout.columns,
  );
  const boxColors = [theme.ink, theme.white, theme.ink, theme.plum, theme.dim, theme.ink];
  const stderr = process.stderr;
  const colorBox = (line: string, i: number) => colorize(line, boxColors[i] ?? theme.dim);

  if (mode === 'inline') {
    const n = Math.max(logo.length, box.length);
    for (let i = 0; i < n; i++) {
      stderr.write(colorize(logo[i] ?? '', theme.mint) + '  ' + colorBox(box[i] ?? '', i) + '\n');
    }
  } else if (mode === 'stacked') {
    for (const l of logo) stderr.write(colorize(l, theme.mint) + '\n');
    stderr.write('\n');
    box.forEach((b, i) => stderr.write(colorBox(b, i) + '\n'));
  } else {
    box.forEach((b, i) => stderr.write(colorBox(b, i) + '\n'));
  }

  stderr.write(colorize(`「${pickLine('greet')}」\n`, theme.wine));
}

// ---------------------------------------------------------------------------
// 交互式配置
// ---------------------------------------------------------------------------

async function ask(rl: readline.Interface, q: string, def?: string): Promise<string> {
  const suffix = def ? ` [${def}]` : '';
  const answer = await rl.question(q + suffix + ': ');
  const trimmed = answer.trim();
  return trimmed || def || '';
}

/** 列出厂商供选择，返回用户选中的厂商。 */
async function askVendor(rl: readline.Interface): Promise<Vendor> {
  console.log(colorize('\n' + t('config.chooseVendor'), theme.white));
  VENDORS.forEach((v, i) => {
    console.log(colorize(`  ${i + 1}. ${t(`vendors.${v.id}`)}`, theme.plum));
  });
  while (true) {
    const answer = (await rl.question(t('config.inputIndex'))).trim();
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= VENDORS.length) return VENDORS[n - 1];
    console.log(colorize(t('config.invalidIndex'), theme.warn));
  }
}

/** 列出请求到的模型列表供选择，也允许手动输入。 */
async function askModelChoice(
  rl: readline.Interface,
  models: string[],
  def: string,
): Promise<string> {
  console.log(colorize('\n' + t('config.modelListTitle'), theme.white));
  const shown = models.slice(0, 20);
  shown.forEach((m, i) => {
    console.log(colorize(`  ${i + 1}. ${m}`, theme.plum));
  });
  if (models.length > shown.length) {
    console.log(colorize(t('config.moreModels', { count: models.length }), theme.dim));
  }
  console.log(colorize(t('config.manualModelOption', { def }), theme.dim));

  while (true) {
    const answer = (await rl.question(t('config.inputIndex'))).trim();
    if (answer === '' || answer === '0') {
      const manual = await ask(rl, t('config.modelName'), def);
      return manual || def;
    }
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= shown.length) return shown[n - 1];
    console.log(colorize(t('config.invalidIndex'), theme.warn));
  }
}

async function configure(): Promise<void> {
  console.log(colorize(t('config.title'), theme.mint));
  const rl = readline.createInterface({ input, output });

  const vendor = await askVendor(rl);

  const apiKey = await ask(rl, vendor.keyHint, '');

  let model = vendor.defaultModel;
  if (apiKey) {
    console.log(colorize('\n' + t('config.requestingModels'), theme.dim));
    try {
      const models = await fetchModels(vendor, apiKey);
      model = models.length
        ? await askModelChoice(rl, models, vendor.defaultModel)
        : await ask(rl, t('config.modelName'), vendor.defaultModel);
    } catch (e) {
      console.log(
        colorize(t('config.modelListFailed', { error: (e as Error).message }), theme.warn),
      );
      model = await ask(rl, t('config.modelName'), vendor.defaultModel);
    }
  } else {
    console.log(colorize(t('config.noApiKey'), theme.warn));
    model = await ask(rl, t('config.modelName'), vendor.defaultModel);
  }

  rl.close();

  writeConfigFile({
    provider: vendor.provider,
    model: model || vendor.defaultModel,
    baseUrl: vendor.baseUrl,
    apiKey: apiKey || undefined,
  });

  console.log(colorize(t('config.saved', { path: configFilePath() }), theme.ok));
  console.log(
    colorize(
      t('config.current', { vendor: t(`vendors.${vendor.id}`), model }),
      theme.plum,
    ),
  );
}

// ---------------------------------------------------------------------------
// one-shot（print）模式
// ---------------------------------------------------------------------------

async function runOneShot(client: ReturnType<typeof createClient>, config: Config, cwd: string, prompt: string): Promise<void> {
  const conv: Conversation = newConversation(cwd);
  const stdout = process.stdout;
  const stderr = process.stderr;

  renderTitle(config, cwd);
  stderr.write(colorize(`「${pickLine('working')}」\n`, theme.plum));

  await runTurn(
    client,
    conv,
    prompt,
    {
      onThinking: (seconds) =>
        stderr.write(colorize(`∴ Thought for ${Math.max(1, Math.round(seconds))}s`, theme.dim) + '\n'),
      onActionTitle: (text) =>
        stderr.write(colorize(`◆ ${text}`, theme.white) + '\n'),
      onText: (text) => stdout.write(text),
      onToolResult: (call, ok, result) => {
        stderr.write(
          colorize(
            `${ok ? '✓' : '✗'} ${toolLabel(call.name)} ${toolTarget(call, cwd)}`,
            ok ? theme.ok : theme.err,
          ) + '\n',
        );
        const allLines = result.replace(/\s+$/, '').split('\n');
        for (const l of allLines.slice(0, MAX_TOOL_RESULT_LINES)) {
          stderr.write(colorize('    ' + l, theme.dim) + '\n');
        }
        if (allLines.length > MAX_TOOL_RESULT_LINES) {
          stderr.write(colorize('    ' + t('run.truncated'), theme.dim2) + '\n');
        }
      },
    },
    new AbortController().signal,
    cwd,
  );

  stdout.write('\n');
  stderr.write(colorize(`「${pickLine('done')}」\n`, theme.dim));
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // 先确定语言（参数 > 环境变量 > 配置），后续所有文案/系统提示词/工具描述都按此语言。
  const lang = resolveLanguage(opts.lang);
  setLanguage(lang);

  if (opts.help) {
    console.log(t('help', { configPath: configFilePath() }));
    return;
  }
  if (opts.version) {
    console.log(VERSION);
    return;
  }

  if (opts.configure) {
    await configure();
    return;
  }

  // 先确定本次是否「运行态」（带问题）：运行态下 --provider/--model/--base-url/--lang 仅本次生效、不落盘。
  let prompt = opts.prompt;
  if (!prompt && !process.stdin.isTTY) {
    prompt = (await readStdin()).trim();
  }
  const isRunMode = Boolean(prompt) || opts.print;

  // 配置落盘：--set-key 总是落盘；其余配置参数仅在非运行态落盘。
  const wantPersist =
    opts.setKey || (!isRunMode && (opts.provider || opts.model || opts.baseUrl || opts.lang));
  if (wantPersist) {
    const patch: Partial<Config> = {};
    if (opts.setKey) patch.apiKey = opts.setKey;
    if (!isRunMode) {
      if (opts.provider) patch.provider = opts.provider;
      if (opts.model) patch.model = opts.model;
      if (opts.baseUrl) patch.baseUrl = opts.baseUrl;
      if (opts.lang) patch.language = lang;
    }
    writeConfigFile(patch);
    console.log(colorize(t('config.updated', { path: configFilePath() }), theme.ok));
    if (!isRunMode) return; // 纯配置命令，落盘后退出
  }

  const config = resolveConfig({
    provider: opts.provider,
    model: opts.model,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    language: lang,
  });

  if (!config.apiKey) {
    console.log(colorize(t('run.noApiKey'), theme.warn));
    console.log(colorize(t('run.apiKeyHint'), theme.dim));
    return;
  }

  const cwd = process.cwd();
  const client = createClient(config);

  if (isRunMode) {
    if (!prompt) {
      console.log(colorize(t('run.needPrompt'), theme.warn));
      return;
    }
    await runOneShot(client, config, cwd, prompt);
    return;
  }

  // 交互式 REPL
  await runInteractive(client, config, cwd);
}

main().catch((e) => {
  process.stderr.write(colorize(t('run.errorPrefix', { error: (e as Error).message }) + '\n', theme.err));
  process.exit(1);
});
