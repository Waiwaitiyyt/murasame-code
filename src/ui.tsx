import { useRef, useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import stringWidth from 'string-width';
import { createClient, type LLMClient, type ToolCall } from './llm.js';
import { runTurn, compactConversation, newConversation, type Conversation, toolLabel, toolTarget } from './agent.js';
import {
  resolveConfig,
  writeConfigFile,
  configFilePath,
  VENDORS,
  fetchModels,
  type Config,
  type PermissionMode,
  type Vendor,
  PERMISSION_MODES,
  isPermissionMode,
} from './config.js';
import { PermissionManager, type PermissionChoice } from './permissions.js';
import { theme, buildBanner, formatCwd } from './theme.js';
import { pickLine } from './persona.js';
import { setLanguage, getLanguage, t, LANGUAGES, isLanguage, type Language } from './i18n.js';
import { describeError } from './errors.js';

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
  { cmd: '/detail', descKey: 'ui.cmdDetail' },
  { cmd: '/model', descKey: 'ui.cmdModel' },
  { cmd: '/cost', descKey: 'ui.cmdCost' },
  { cmd: '/compact', descKey: 'ui.cmdCompact' },
  { cmd: '/permission', descKey: 'ui.cmdPermission' },
  { cmd: '/exit', descKey: 'ui.cmdExit' },
];

/** 命令输出详细程度：0=不打印 1=仅命令 2=命令+前三行 3=全部 */
type DetailLevel = 0 | 1 | 2 | 3;
const DETAIL_LEVELS: DetailLevel[] = [0, 1, 2, 3];
const DETAIL_LEVEL_KEYS = ['off', 'command', 'threeLines', 'all'] as const;

type ConfigStep = 'vendor' | 'key' | 'model';

type PromptMode =
  | { kind: 'chat' }
  | { kind: 'lang' }
  | { kind: 'detail' }
  | { kind: 'permission' }
  | { kind: 'config'; step: ConfigStep; vendor?: Vendor; apiKey?: string; models?: string[] };

function App({ client, config, cwd, columns }: { client: LLMClient; config: Config; cwd: string; columns: number }) {
  const convRef = useRef<Conversation>(newConversation(cwd));
  const clientRef = useRef<LLMClient>(client);
  const permissionRef = useRef(new PermissionManager(config.permissionMode, config.approvedActions, writeConfigFile, cwd));
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(config.permissionMode);
  const [cfg, setCfg] = useState<Config>(config);
  const [mode, setMode] = useState<PromptMode>({ kind: 'chat' });
  const [items, setItems] = useState<Item[]>([{ kind: 'banner' }]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const inputHistory = useRef<string[]>([]);
  const historyIndex = useRef<number | null>(null);
  const historyDraft = useRef('');
  const [detail, setDetail] = useState<DetailLevel>(3);
  const [streamText, setStreamText] = useState('');
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [approval, setApproval] = useState<ToolCall | null>(null);
  const [approvalIndex, setApprovalIndex] = useState(1);
  const approvalIndexRef = useRef(1);
  const approvalRef = useRef<((choice: PermissionChoice) => void) | null>(null);
  const { exit } = useApp();
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
    if (approvalRef.current) {
      if (key.ctrl && inputStr === 'c') {
        abortRef.current?.abort();
        push({ kind: 'status', level: 'info', text: t('ui.aborted') });
      } else if (key.upArrow || key.downArrow || key.tab) {
        const delta = key.upArrow ? -1 : 1;
        approvalIndexRef.current = (approvalIndexRef.current + delta + 3) % 3;
        setApprovalIndex(approvalIndexRef.current);
      } else if (key.return) {
        approvalRef.current((['yes', 'no', 'always'] as const)[approvalIndexRef.current]);
      } else if (key.escape) {
        approvalRef.current('no');
      } else if (/^[123]$/.test(inputStr)) {
        approvalRef.current((['yes', 'no', 'always'] as const)[Number(inputStr) - 1]);
      }
      return;
    }
    if (!busy && mode.kind === 'chat' && (key.upArrow || key.downArrow)) {
      const history = inputHistory.current;
      if (key.upArrow && history.length > 0) {
        if (historyIndex.current === null) {
          historyDraft.current = input;
          historyIndex.current = history.length - 1;
        } else {
          historyIndex.current = Math.max(0, historyIndex.current - 1);
        }
        setInput(history[historyIndex.current]);
      } else if (key.downArrow && historyIndex.current !== null) {
        historyIndex.current++;
        if (historyIndex.current >= history.length) {
          historyIndex.current = null;
          setInput(historyDraft.current);
        } else {
          setInput(history[historyIndex.current]);
        }
      }
      return;
    }
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

  function applyPermissionMode(next: PermissionMode) {
    try {
      permissionRef.current.setMode(next);
      setPermissionMode(next);
      setMode({ kind: 'chat' });
      push({ kind: 'status', level: 'info', text: t('ui.permissionSwitched', { mode: next.replace('-', ' ') }) });
    } catch (error) {
      push({ kind: 'status', level: 'err', text: t('run.errorPrefix', { error: describeError(error) }) });
    }
  }

  function startPermissionMode() {
    setMode({ kind: 'permission' });
    push({ kind: 'status', level: 'info', text: t('ui.permissionCurrent', { mode: permissionMode.replace('-', ' ') }) });
    push({ kind: 'status', level: 'info', text: t('ui.permissionRemembered', { count: permissionRef.current.rememberedCount() }) });
    PERMISSION_MODES.forEach((value, index) => {
      push({ kind: 'status', level: 'info', text: `  ${index + 1}. ${value.replace('-', ' ')} — ${t(`ui.permissionModes.${value.replace('-', '')}`)}` });
    });
    push({ kind: 'status', level: 'info', text: t('ui.permissionResetHint') });
  }

  function startLangMode() {
    setMode({ kind: 'lang' });
    push({ kind: 'status', level: 'info', text: t('ui.langTitle') });
    LANGUAGES.forEach((l, i) =>
      push({ kind: 'status', level: 'info', text: `  ${i + 1}. ${t(`langNames.${l}`)}` }),
    );
    push({ kind: 'status', level: 'info', text: t('ui.langPrompt') });
  }

  function detailLevelName(level: DetailLevel): string {
    return t(`detail.levels.${DETAIL_LEVEL_KEYS[level]}`);
  }

  function applyDetail(level: DetailLevel) {
    setDetail(level);
    push({ kind: 'status', level: 'info', text: t('detail.switched', { level: detailLevelName(level) }) });
    setMode({ kind: 'chat' });
  }

  function startDetailMode() {
    setMode({ kind: 'detail' });
    push({ kind: 'status', level: 'info', text: t('detail.title') });
    DETAIL_LEVELS.forEach((l, i) =>
      push({ kind: 'status', level: 'info', text: `  ${i + 1}. ${detailLevelName(l)}` }),
    );
    push({ kind: 'status', level: 'info', text: t('detail.prompt') });
  }

  function parseDetailLevel(q: string): DetailLevel | null {
    const s = q.trim();
    if (s === '') return null;
    const idx = DETAIL_LEVEL_KEYS.indexOf(s as (typeof DETAIL_LEVEL_KEYS)[number]);
    if (idx !== -1) return DETAIL_LEVELS[idx];
    const n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= DETAIL_LEVELS.length) return DETAIL_LEVELS[n - 1];
    return null;
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
    if (mode.kind === 'permission') {
      if (!q) {
        setMode({ kind: 'chat' });
        return;
      }
      const normalized = q.toLowerCase().replace(/\s+/g, '-');
      const chosen = PERMISSION_MODES[Number(q) - 1]
        ?? (isPermissionMode(normalized) ? normalized : null);
      if (chosen) applyPermissionMode(chosen);
      else push({ kind: 'status', level: 'err', text: t('config.invalidIndex') });
      return;
    }
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

    if (mode.kind === 'detail') {
      if (!q) {
        setMode({ kind: 'chat' });
        return;
      }
      const level = parseDetailLevel(q);
      if (level != null) applyDetail(level);
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
    if (approvalRef.current) {
      approvalRef.current(q === '3' ? 'always' : q === '1' || q.toLowerCase() === 'yes' ? 'yes' : 'no');
      return;
    }
    historyIndex.current = null;
    historyDraft.current = '';
    if (q && inputHistory.current.at(-1) !== q) inputHistory.current.push(q);
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
    setStreamText('');
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
          onTextDelta: (delta) => setStreamText((prev) => prev + delta),
          onActionTitle: (text) => {
            setStreamText('');
            push({ kind: 'actionTitle', text });
          },
          onText: (text) => {
            setStreamText('');
            push({ kind: 'assistant', text });
          },
          onToolResult: (call, ok, result) =>
            push({
              kind: 'tool',
              ok,
              label: toolLabel(call.name),
              target: toolTarget(call, cwd),
              result,
            }),
          onUsage: (inputTokens, outputTokens) =>
            setUsage((prev) => ({ input: prev.input + inputTokens, output: prev.output + outputTokens })),
          confirmTool: (call) => new Promise<PermissionChoice>((resolve) => {
            const finish = (choice: PermissionChoice) => {
              controller.signal.removeEventListener('abort', onAbort);
              approvalRef.current = null;
              setApproval(null);
              resolve(choice);
            };
            const onAbort = () => finish('no');
            approvalIndexRef.current = 1;
            setApprovalIndex(1);
            approvalRef.current = finish;
            setApproval(call);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) onAbort();
          }),
        },
        controller.signal,
        cwd,
        permissionRef.current,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        push({ kind: 'status', level: 'err', text: t('run.errorPrefix', { error: describeError(e) }) });
      }
    } finally {
      setStreamText('');
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
        setUsage({ input: 0, output: 0 });
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
      case '/detail': {
        const level = arg ? parseDetailLevel(arg) : null;
        if (arg && level != null) applyDetail(level);
        else if (arg) push({ kind: 'status', level: 'err', text: t('ui.unknownCommand', { name }) });
        else startDetailMode();
        break;
      }
      case '/model': {
        if (!arg) {
          push({ kind: 'status', level: 'info', text: t('ui.currentModel', { model: cfg.model }) });
          break;
        }
        const next = { ...cfg, model: arg };
        writeConfigFile({ model: arg });
        setCfg(next);
        clientRef.current = createClient(next);
        push({ kind: 'status', level: 'info', text: t('ui.modelSwitched', { model: arg }) });
        break;
      }
      case '/cost':
        push({
          kind: 'status',
          level: 'info',
          text: usage.input + usage.output > 0
            ? t('ui.tokenUsage', { input: usage.input, output: usage.output })
            : t('ui.noUsage'),
        });
        break;
      case '/compact':
        void compactHistory();
        break;
      case '/permission':
        if (arg === 'reset') {
          try {
            permissionRef.current.clearRemembered();
            push({ kind: 'status', level: 'info', text: t('ui.permissionCleared') });
          } catch (error) {
            push({ kind: 'status', level: 'err', text: t('run.errorPrefix', { error: describeError(error) }) });
          }
        } else if (arg) {
          const normalized = arg.toLowerCase().replace(/\s+/g, '-');
          if (isPermissionMode(normalized)) applyPermissionMode(normalized);
          else push({ kind: 'status', level: 'err', text: t('ui.permissionInvalid') });
        } else {
          startPermissionMode();
        }
        break;
      default:
        push({ kind: 'status', level: 'err', text: t('ui.unknownCommand', { name }) });
    }
  }

  async function compactHistory() {
    if (busy) return;
    if (convRef.current.length <= 1) {
      push({ kind: 'status', level: 'info', text: t('ui.nothingToCompact') });
      return;
    }
    setBusy(true);
    push({ kind: 'status', level: 'info', text: t('ui.compacting') });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { usage: compactUsage } = await compactConversation(clientRef.current, convRef.current, controller.signal);
      if (compactUsage) {
        setUsage((prev) => ({
          input: prev.input + compactUsage.inputTokens,
          output: prev.output + compactUsage.outputTokens,
        }));
      }
      push({ kind: 'status', level: 'info', text: t('ui.compacted') });
    } catch (error) {
      if (!controller.signal.aborted) {
        push({ kind: 'status', level: 'err', text: t('run.errorPrefix', { error: describeError(error) }) });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  const visible = items.slice(-120);
  const modeHint =
    mode.kind === 'lang'
      ? t('ui.langPrompt')
      : mode.kind === 'detail'
        ? t('detail.prompt')
        : mode.kind === 'permission'
          ? t('ui.permissionSelect')
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
              columns,
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
            if (detail === 0) return null; // 完全不打印
            const allLines = item.result.replace(/\s+$/, '').split('\n');
            const maxLines = detail === 3 ? allLines.length : detail === 2 ? 3 : 0;
            const lines = allLines.slice(0, maxLines);
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
                {allLines.length > maxLines && (
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

      {streamText && (
        <Text color={theme.white}>{streamText}</Text>
      )}

      <Box marginTop={1}>
        {busy ? (
          approval ? (
            <Box flexDirection="column">
              <Text color={theme.warn}>{t('ui.approvalPrompt')}</Text>
              <Text color={theme.white}>
                {approval.name === 'bash'
                  ? String(approval.input.command ?? '')
                  : `${toolLabel(approval.name)} ${toolTarget(approval, cwd)}`}
              </Text>
              {(['yes', 'no', 'always'] as const).map((choice, index) => (
                <Text key={choice} color={index === approvalIndex ? theme.mint : theme.dim}>
                  {index === approvalIndex ? '❯' : ' '} {index + 1}. {t(
                    choice === 'always' && approval.name !== 'bash'
                      ? 'ui.permissionChoices.alwaysExact'
                      : `ui.permissionChoices.${choice}`, {
                    action: (approval.name === 'bash'
                      ? String(approval.input.command ?? '')
                      : `${toolLabel(approval.name)} ${toolTarget(approval, cwd)}`).slice(0, 50),
                  })}
                </Text>
              ))}
              <Text color={theme.dim2}>{t('ui.permissionKeys')}</Text>
            </Box>
          ) : (
            <Text color={theme.dim}>{t('ui.busy')}</Text>
          )
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
              <TextInput value={input} onChange={(value) => {
                historyIndex.current = null;
                setInput(value);
              }} onSubmit={onSubmit} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export async function runInteractive(client: LLMClient, config: Config, cwd: string): Promise<void> {
  const stdout = process.stdout;
  const useAlternateScreen = process.stdin.isTTY && stdout.isTTY;
  const bannerOptions = { provider: config.provider, model: config.model, cwd: formatCwd(cwd) };
  const bannerWidth = (columns: number) => {
    const { mode, logo, box } = buildBanner(bannerOptions, columns);
    const logoWidth = Math.max(0, ...logo.map((line) => stringWidth(line)));
    const boxWidth = Math.max(0, ...box.map((line) => stringWidth(line)));
    return mode === 'inline' ? logoWidth + 2 + boxWidth : Math.max(logoWidth, boxWidth);
  };
  let columns = stdout.columns || 80;
  let restored = false;
  const restore = () => {
    if (!useAlternateScreen || restored) return;
    restored = true;
    stdout.write('\u001b[?1049l');
  };

  if (useAlternateScreen) {
    process.once('exit', restore);
    stdout.write('\u001b[?1049h\u001b[H');
  }
  try {
    const draw = () => <App client={client} config={config} cwd={cwd} columns={columns} />;
    const instance = render(draw(), { exitOnCtrlC: false });
    const onResize = () => {
      const nextColumns = stdout.columns || 80;
      if (nextColumns === columns) return;
      // Ink 按旧行数擦除，缩窄后旧行已被终端折行，必须重置备用屏幕。
      if (useAlternateScreen && nextColumns <= bannerWidth(columns)) {
        instance.clear();
        stdout.write('\u001b[2J\u001b[H');
      }
      columns = nextColumns;
      instance.rerender(draw());
    };
    stdout.on('resize', onResize);
    try {
      await instance.waitUntilExit();
    } finally {
      stdout.off('resize', onResize);
    }
  } finally {
    restore();
    process.off('exit', restore);
  }
}
