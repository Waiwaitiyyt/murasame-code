import { useRef, useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { createClient, type LLMClient } from './llm.js';
import { runTurn, newConversation, type Conversation, toolLabel, toolTarget } from './agent.js';
import {
  resolveConfig,
  writeConfigFile,
  configFilePath,
  VENDORS,
  fetchModels,
  type Config,
  type Vendor,
} from './config.js';
import { theme, buildBanner, formatCwd } from './theme.js';
import { pickLine } from './persona.js';
import { setLanguage, getLanguage, t, LANGUAGES, isLanguage, type Language } from './i18n.js';

type Item =
  | { kind: 'banner' }
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; seconds: number }
  | { kind: 'actionTitle'; text: string }
  | { kind: 'tool'; ok: boolean; label: string; target: string; result: string }
  | { kind: 'status'; level: 'info' | 'err'; text: string };

const COMMANDS = [
  { cmd: '/help', descKey: 'ui.cmdHelp' },
  { cmd: '/clear', descKey: 'ui.cmdClear' },
  { cmd: '/config', descKey: 'ui.cmdConfig' },
  { cmd: '/lang', descKey: 'ui.cmdLang' },
  { cmd: '/exit', descKey: 'ui.cmdExit' },
];

const MAX_TOOL_RESULT_LINES = 20;

type ConfigStep = 'vendor' | 'key' | 'model';

type PromptMode =
  | { kind: 'chat' }
  | { kind: 'lang' }
  | { kind: 'config'; step: ConfigStep; vendor?: Vendor; apiKey?: string; models?: string[] };

function App({ client, config, cwd }: { client: LLMClient; config: Config; cwd: string }) {
  const convRef = useRef<Conversation>(newConversation(cwd));
  const clientRef = useRef<LLMClient>(client);
  const [cfg, setCfg] = useState<Config>(config);
  const [mode, setMode] = useState<PromptMode>({ kind: 'chat' });
  const [items, setItems] = useState<Item[]>([{ kind: 'banner' }]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const { exit } = useApp();
  const { stdout } = useStdout();
  const abortRef = useRef<AbortController | null>(null);
  const [greet, setGreet] = useState(() => pickLine('greet'));

  // 台词每 5~10 秒随机换一条（与按键/渲染解耦）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setGreet(pickLine('greet'));
          schedule();
        },
        5000 + Math.random() * 5000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const push = (item: Item) => setItems((prev) => [...prev, item]);

  useInput((inputStr, key) => {
    if (key.ctrl && inputStr === 'c') {
      if (busy && abortRef.current) {
        abortRef.current.abort();
        push({ kind: 'status', level: 'info', text: t('ui.aborted') });
      } else {
        exit();
      }
    }
  });

  function applyLanguage(lang: Language) {
    setLanguage(lang);
    writeConfigFile({ language: lang });
    setGreet(pickLine('greet'));
    convRef.current = newConversation(cwd);
    push({ kind: 'status', level: 'info', text: t('ui.langSwitched', { lang: t(`langNames.${lang}`) }) });
    setMode({ kind: 'chat' });
  }

  function startLangMode() {
    setMode({ kind: 'lang' });
    push({ kind: 'status', level: 'info', text: t('ui.langTitle') });
    LANGUAGES.forEach((l, i) =>
      push({ kind: 'status', level: 'info', text: `  ${i + 1}. ${t(`langNames.${l}`)}` }),
    );
    push({ kind: 'status', level: 'info', text: t('ui.langPrompt') });
  }

  function startConfigMode() {
    setMode({ kind: 'config', step: 'vendor' });
    push({ kind: 'status', level: 'info', text: t('config.chooseVendor') });
    VENDORS.forEach((v, i) =>
      push({ kind: 'status', level: 'info', text: `  ${i + 1}. ${t(`vendors.${v.id}`)}` }),
    );
    push({ kind: 'status', level: 'info', text: t('config.inputIndex') });
  }

  function parseLang(q: string): Language | null {
    const s = q.trim();
    if (isLanguage(s)) return s;
    const n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= LANGUAGES.length) return LANGUAGES[n - 1];
    return null;
  }

  async function handleModeInput(q: string) {
    if (mode.kind === 'lang') {
      if (!q) {
        setMode({ kind: 'chat' });
        return;
      }
      const lang = parseLang(q);
      if (lang) applyLanguage(lang);
      else push({ kind: 'status', level: 'err', text: t('config.invalidIndex') });
      return;
    }

    if (mode.kind === 'config') {
      await handleConfigInput(q);
    }
  }

  async function handleConfigInput(q: string) {
    if (mode.kind !== 'config') return;

    if (mode.step === 'vendor') {
      if (!q) {
        push({ kind: 'status', level: 'info', text: t('ui.cancelled') });
        setMode({ kind: 'chat' });
        return;
      }
      const n = Number(q);
      if (Number.isInteger(n) && n >= 1 && n <= VENDORS.length) {
        const vendor = VENDORS[n - 1];
        setMode({ kind: 'config', step: 'key', vendor });
        push({ kind: 'status', level: 'info', text: vendor.keyHint });
        push({ kind: 'status', level: 'info', text: t('config.keyPrompt') });
      } else {
        push({ kind: 'status', level: 'err', text: t('config.invalidIndex') });
      }
      return;
    }

    if (mode.step === 'key') {
      const vendor = mode.vendor!;
      const apiKey = q;
      if (!apiKey) {
        push({ kind: 'status', level: 'info', text: t('config.noApiKey') });
      }

      setMode({ kind: 'config', step: 'model', vendor, apiKey: apiKey || '' });
      if (apiKey) {
        push({ kind: 'status', level: 'info', text: t('config.requestingModels') });
        let models: string[] = [];
        try {
          models = await fetchModels(vendor, apiKey);
        } catch (e) {
          push({ kind: 'status', level: 'err', text: t('config.modelListFailed', { error: (e as Error).message }) });
        }
        if (models.length) {
          setMode({ kind: 'config', step: 'model', vendor, apiKey, models });
          push({ kind: 'status', level: 'info', text: t('config.modelListTitle') });
          models.slice(0, 20).forEach((m, i) =>
            push({ kind: 'status', level: 'info', text: `  ${i + 1}. ${m}` }),
          );
          push({ kind: 'status', level: 'info', text: t('config.manualModelOption', { def: vendor.defaultModel }) });
        } else {
          push({ kind: 'status', level: 'info', text: t('config.modelName') });
        }
      } else {
        push({ kind: 'status', level: 'info', text: t('config.modelName') });
      }
      return;
    }

    // step === 'model'
    const vendor = mode.vendor!;
    const apiKey = mode.apiKey ?? '';
    const models = mode.models ?? [];
    let model = vendor.defaultModel;
    if (q) {
      const n = Number(q);
      if (models.length && Number.isInteger(n) && n >= 1 && n <= models.length) {
        model = models[n - 1];
      } else {
        model = q;
      }
    }

    const chosen = {
      provider: vendor.provider,
      model: model || vendor.defaultModel,
      baseUrl: vendor.baseUrl,
      apiKey: apiKey || undefined,
    };
    writeConfigFile(chosen);

    const newCfg = resolveConfig({ ...chosen, language: getLanguage() });
    setCfg(newCfg);
    clientRef.current = createClient(newCfg);

    push({ kind: 'status', level: 'info', text: t('config.saved', { path: configFilePath() }) });
    push({
      kind: 'status',
      level: 'info',
      text: t('config.current', { vendor: t(`vendors.${vendor.id}`), model: chosen.model }),
    });
    setMode({ kind: 'chat' });
  }

  function onSubmit(text: string) {
    const q = text.trim();
    setInput('');
    if (mode.kind !== 'chat') {
      void handleModeInput(q);
      return;
    }
    if (!q) return;
    if (q.startsWith('/')) {
      handleCommand(q);
      return;
    }
    if (busy) return;
    void executeTurn(q);
  }

  async function executeTurn(q: string) {
    setBusy(true);
    push({ kind: 'user', text: q });
    push({ kind: 'status', level: 'info', text: pickLine('working') });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runTurn(
        clientRef.current,
        convRef.current,
        q,
        {
          onThinking: (seconds) =>
            push({ kind: 'thinking', seconds: Math.max(1, Math.round(seconds)) }),
          onActionTitle: (text) => push({ kind: 'actionTitle', text }),
          onText: (text) => push({ kind: 'assistant', text }),
          onToolResult: (call, ok, result) =>
            push({
              kind: 'tool',
              ok,
              label: toolLabel(call.name),
              target: toolTarget(call, cwd),
              result,
            }),
        },
        controller.signal,
        cwd,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        push({ kind: 'status', level: 'err', text: t('run.errorPrefix', { error: (e as Error).message }) });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      push({ kind: 'status', level: 'info', text: pickLine('done') });
    }
  }

  function handleCommand(cmd: string) {
    const [name, arg] = cmd.split(/\s+/);
    switch (name) {
      case '/exit':
      case '/quit':
        exit();
        break;
      case '/clear':
        setItems([{ kind: 'banner' }]);
        convRef.current = newConversation(cwd);
        break;
      case '/help':
        push({ kind: 'status', level: 'info', text: t('ui.helpCommand') });
        break;
      case '/config':
        startConfigMode();
        break;
      case '/lang':
        if (arg && isLanguage(arg)) applyLanguage(arg);
        else startLangMode();
        break;
      default:
        push({ kind: 'status', level: 'err', text: t('ui.unknownCommand', { name }) });
    }
  }

  const visible = items.slice(-120);
  const modeHint =
    mode.kind === 'lang'
      ? t('ui.langPrompt')
      : mode.kind === 'config'
        ? t('ui.cancelHint')
        : null;

  return (
    <Box flexDirection="column">
      {visible.map((item, i) => {
        switch (item.kind) {
          case 'banner': {
            const { mode, logo, box } = buildBanner(
              {
                provider: cfg.provider,
                model: cfg.model,
                cwd: formatCwd(cwd),
              },
              stdout.columns,
            );
            const boxColors = [
              theme.ink,
              theme.white,
              theme.ink,
              theme.plum,
              theme.dim,
              theme.ink,
            ];
            const logoNode =
              logo.length > 0 ? (
                <Box flexDirection="column">
                  {logo.map((line, j) => (
                    <Text key={j} color={theme.mint}>
                      {line}
                    </Text>
                  ))}
                </Box>
              ) : null;
            const boxNode = (
              <Box flexDirection="column">
                {box.map((line, j) => (
                  <Text key={j} color={boxColors[j]}>
                    {line}
                  </Text>
                ))}
              </Box>
            );
            return (
              <Box key={i} flexDirection="column" marginBottom={1}>
                {mode === 'inline' ? (
                  <Box>
                    {logoNode}
                    <Box marginLeft={2}>{boxNode}</Box>
                  </Box>
                ) : (
                  <Box flexDirection="column">
                    {logoNode}
                    {logoNode ? <Box marginTop={1}>{boxNode}</Box> : boxNode}
                  </Box>
                )}
                <Text color={theme.wine} bold>
                  {greet}
                </Text>
              </Box>
            );
          }
          case 'user':
            return (
              <Text key={i} color={theme.wine} bold>
                {t('ui.userPrefix')}
                {item.text}
              </Text>
            );
          case 'assistant':
            return (
              <Text key={i} color={theme.white}>
                {item.text}
              </Text>
            );
          case 'thinking':
            return (
              <Text key={i} color={theme.dim}>
                ∴ Thought for {item.seconds}s
              </Text>
            );
          case 'actionTitle':
            return (
              <Text key={i} color={theme.white} bold>
                ◆ {item.text}
              </Text>
            );
          case 'tool': {
            const allLines = item.result.replace(/\s+$/, '').split('\n');
            const lines = allLines.slice(0, MAX_TOOL_RESULT_LINES);
            return (
              <Box key={i} flexDirection="column">
                <Text color={item.ok ? theme.ok : theme.err}>
                  {item.ok ? '✓' : '✗'} {item.label} {item.target}
                </Text>
                {lines.map((l, j) => (
                  <Text key={j} color={theme.dim}>
                    {'    ' + l}
                  </Text>
                ))}
                {allLines.length > MAX_TOOL_RESULT_LINES && (
                  <Text color={theme.dim2}>    {t('run.truncated')}</Text>
                )}
              </Box>
            );
          }
          case 'status': {
            const color = item.level === 'err' ? theme.err : theme.dim;
            return (
              <Text key={i} color={color}>
                {item.text}
              </Text>
            );
          }
        }
      })}

      <Box marginTop={1}>
        {busy ? (
          <Text color={theme.dim}>{t('ui.busy')}</Text>
        ) : (
          <Box flexDirection="column">
            {mode.kind === 'chat' && input.startsWith('/') && (
              <Box flexDirection="column" marginBottom={1}>
                {COMMANDS.filter((c) => c.cmd.startsWith(input.trim() || '/')).map((c, i) => (
                  <Text key={i} color={theme.dim}>
                    <Text color={theme.mint} bold>
                      {c.cmd}
                    </Text>
                    {'  '}
                    {t(c.descKey)}
                  </Text>
                ))}
              </Box>
            )}
            {modeHint && (
              <Box marginBottom={1}>
                <Text color={theme.dim}>{modeHint}</Text>
              </Box>
            )}
            <Box>
              <Text color={theme.mint} bold>
                {t('ui.inputPrompt')}
              </Text>
              <Text color={theme.ink}> ❯ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function runInteractive(client: LLMClient, config: Config, cwd: string): Promise<void> {
  const instance = render(<App client={client} config={config} cwd={cwd} />, { exitOnCtrlC: false });
  return instance.waitUntilExit();
}
