/**
 * i18n 类型定义（纯类型 + 常量，避免循环依赖）。
 * 语言词典 zh/en/ja 均实现 LocaleMessages 接口，保证键位一致。
 */

export type Language = 'zh' | 'en' | 'ja';

export const LANGUAGES: Language[] = ['zh', 'en', 'ja'];
export const DEFAULT_LANGUAGE: Language = 'zh';

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as string[]).includes(v);
}

export interface ToolLabels {
  read_file: string;
  write_file: string;
  edit: string;
  bash: string;
  grep_search: string;
  glob: string;
}

export interface PersonaLines {
  greet: string[];
  working: string[];
  thinking: string[];
  done: string[];
  error: string[];
  idle: string[];
}

export type LineGroup = keyof PersonaLines;

export interface LocaleMessages {
  /** --help 全文，{configPath} 占位 */
  help: string;

  /** 系统提示词里的核心职责/工具规则/输出要求，{cwd} 占位 */
  promptGuide: string;

  /** 语言显示名（当前语言视角） */
  langNames: {
    zh: string;
    en: string;
    ja: string;
  };

  args: {
    /** 未知参数 {flag} */
    unknownFlag: string;
  };

  run: {
    /** print 模式缺问题 */
    needPrompt: string;
    /** 未配置 API Key */
    noApiKey: string;
    /** 未配置 Key 时的提示 */
    apiKeyHint: string;
    /** 输出截断 */
    truncated: string;
    /** 出错：{error} */
    errorPrefix: string;
    rateLimited: string;
    authFailed: string;
    serverUnavailable: string;
  };

  config: {
    title: string;
    chooseVendor: string;
    inputIndex: string;
    invalidIndex: string;
    modelListTitle: string;
    /** 共 {count} 个 */
    moreModels: string;
    /** 手动输入模型名（默认 {def}） */
    manualModelOption: string;
    modelName: string;
    requestingModels: string;
    /** 获取模型列表失败（{error}） */
    modelListFailed: string;
    noApiKey: string;
    /** 输入 API Key（回车跳过） */
    keyPrompt: string;
    /** 配置已保存 → {path} */
    saved: string;
    /** 配置已更新 → {path} */
    updated: string;
    /** 当前：{vendor} / {model} */
    current: string;
  };

  ui: {
    cmdHelp: string;
    cmdClear: string;
    cmdExit: string;
    cmdConfig: string;
    cmdLang: string;
    cmdDetail: string;
    cmdModel: string;
    cmdCost: string;
    cmdCompact: string;
    cmdPermission: string;
    currentModel: string;
    modelSwitched: string;
    tokenUsage: string;
    noUsage: string;
    approvalPrompt: string;
    permissionCurrent: string;
    permissionRemembered: string;
    permissionResetHint: string;
    permissionSwitched: string;
    permissionCleared: string;
    permissionInvalid: string;
    permissionSelect: string;
    permissionKeys: string;
    permissionModes: { auto: string; manual: string; fullaccess: string };
    permissionChoices: { yes: string; no: string; always: string; alwaysExact: string };
    compacting: string;
    compacted: string;
    nothingToCompact: string;
    /** 已中止 */
    aborted: string;
    /** 用户前缀「主人 › 」 */
    userPrefix: string;
    helpCommand: string;
    /** 未知命令 {name} */
    unknownCommand: string;
    /** 工作中 */
    busy: string;
    /** 输入提示符（角色名） */
    inputPrompt: string;
    /** 选择语言： */
    langTitle: string;
    /** 输入序号或 zh/en/ja（回车取消） */
    langPrompt: string;
    /** 语言已切换 → {lang} */
    langSwitched: string;
    /** 已取消 */
    cancelled: string;
    /** （回车取消） */
    cancelHint: string;
  };

  detail: {
    /** 选择命令输出显示级别： */
    title: string;
    /** 输入序号 1-4（回车取消） */
    prompt: string;
    /** 命令输出详细程度已切换 → {level} */
    switched: string;
    /** 当前：{level} */
    current: string;
    levels: {
      /** 完全不打印 */
      off: string;
      /** 只打印命令本身 */
      command: string;
      /** 打印命令+前三行 */
      threeLines: string;
      /** 全部打印 */
      all: string;
    };
  };

  tools: {
    labels: ToolLabels;

    readFileDesc: string;
    readFileFilePath: string;
    readFileOffset: string;
    readFileLimit: string;

    writeFileDesc: string;
    writeFileFilePath: string;
    writeFileContent: string;

    editDesc: string;
    editFilePath: string;
    editOldString: string;
    editNewString: string;
    editReplaceAll: string;

    bashDesc: string;
    bashCommand: string;

    grepDesc: string;
    grepPattern: string;
    grepPath: string;
    grepGlob: string;

    globDesc: string;
    globPattern: string;
    globPath: string;

    /** 错误：未知工具 "{name}" */
    unknownTool: string;
    /** 错误：文件不存在 {path} */
    fileNotFound: string;
    /** 错误：{path} 是目录 */
    isDirectory: string;
    /** 错误：文件过大 {path} */
    fileTooLarge: string;
    /** [{path}] {total} 行（显示 {start}-{end}） */
    readHeader: string;
    /** 已写入 {bytes} 字节 → {path} */
    wroteBytes: string;
    /** 错误：old_string 不能为空 */
    oldStringEmpty: string;
    /** 错误：old_string 未在文件中找到（{path}） */
    oldStringNotFound: string;
    /** 错误：old_string 匹配了 {count} 处…首个匹配上下文 */
    oldStringMultiple: string;
    /** 已替换 {count} 处 → {path} */
    replaced: string;
    /** 错误：command 不能为空 */
    commandEmpty: string;
    /** （无输出） */
    noOutput: string;
    /** 命令退出码 {code}{killed} */
    commandExitCode: string;
    /** （命令超时被终止） */
    commandTimeout: string;
    /** 错误：pattern 不能为空 */
    patternEmpty: string;
    /** 错误：无效正则 {pattern} — {error} */
    invalidRegex: string;
    /** …（已达匹配上限 {max}） */
    matchLimit: string;
    /** 未找到匹配 "{pattern}" */
    noMatches: string;
  };

  agent: {
    /** 工具执行异常：{error} */
    toolExecError: string;
    /** （已达最大迭代次数） */
    maxIterations: string;
    commandApprovalRequired: string;
    toolCancelled: string;
  };

  vendors: {
    anthropic: string;
    openai: string;
    deepseek: string;
    zhipu: string;
    moonshot: string;
    qwen: string;
  };

  persona: {
    prompt: string;
    lines: PersonaLines;
  };
}
