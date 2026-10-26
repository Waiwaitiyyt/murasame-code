# 丛雨代码 · murasame

本项目采用 [GNU General Public License v3.0](LICENSE) 许可证。

> 终端里的丛雨（千恋＊万花 · ムラサメ）AI 编程代理，用法类似 Claude Code。

一个能力完整的命令行编程 Agent：能真正**读文件、改代码、执行命令、搜索文件**，用丛雨的口吻与配色陪伴你工作。

```
┌────────────────────────────────────────────────────────┐
│ >_ Murasame Code (v0.1.0)                              │
│                                                        │
│ Claude API Key | [claude] claude-sonnet-4-5            │
│ ~/murasame-code                                        │
└────────────────────────────────────────────────────────┘
```

交互模式会在终端备用屏幕中打开，退出后恢复原屏幕。窗口宽度变化时，`MURASAME` 标题会在大字、紧凑字和普通文字之间自动切换，避免换行。

## 特性

- 🗡️ **完整 Agent**：`read_file` / `write_file` / `edit` / `bash` / `grep_search` / `glob` 工具循环，像 Claude Code 一样自动完成任务。
- 🌸 **丛雨主题**：淡紫 + 樱花粉配色、千恋万花风格 banner。
- 🔑 **自带 API Key**：支持 Anthropic Claude 与任意 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / OpenAI …），可自定义 `base_url`。
- 💬 **交互式 REPL**（Ink 终端 UI）+ **print 单次问答**（可接管道 / 脚本化）。

## 安装

需要 Node.js ≥ 18.18。

```bash
cd murasame-code
npm install
npm run build          # 编译到 dist/

# 可选：全局安装，之后直接敲 murasame
npm link
```

## 配置 API Key

**方式一：交互式配置（推荐）**

```bash
murasame --configure
```

按提示选择接口类型、填入 API Key、模型名、base URL。

**方式二：命令行设置**

```bash
murasame --set-key sk-xxxx            # 设置 Key
murasame --provider openai            # 设置接口（claude / openai）
murasame --model gpt-4o               # 设置模型
murasame --base-url https://api.openai.com/v1
```

**方式三：环境变量**

```bash
export MURASAME_API_KEY=sk-xxxx
export MURASAME_PROVIDER=openai        # claude 或 openai
export MURASAME_MODEL=gpt-4o
export MURASAME_BASE_URL=https://api.openai.com/v1
# Claude 时也可用 ANTHROPIC_API_KEY；OpenAI 时也可用 OPENAI_API_KEY
```

配置文件保存在 `~/.murasame/config.json`。

## 使用

```bash
murasame                    # 交互式对话（REPL）
murasame "帮我修复这个 bug"   # 单次问答，结果输出到 stdout
murasame -p "解释这段代码"    # 显式 print 模式
echo "重构 src/auth.ts" | murasame   # 从标准输入读取
```

**交互式命令**

| 命令 | 作用 |
|------|------|
| `/help` | 帮助 |
| `/clear` | 清空上下文 |
| `/config` | 重新配置 API |
| `/lang` | 切换语言（zh / en / ja） |
| `/detail` | 调整命令输出详细程度（不打印 / 仅命令 / 命令+前三行 / 全部） |
| `/model 名称` | 查看或切换当前模型 |
| `/cost` | 查看供应商返回的 token 用量；准确费用以供应商账单为准 |
| `/compact` | 调用当前模型将对话压缩为摘要 |
| `↑` / `↓` | 浏览输入历史 |
| `/exit` `/quit` | 退出 |
| `Ctrl+C` | 中止当前任务（空闲时退出） |

常见的删除、强制重置等高风险 shell 命令会在交互模式中要求输入 `yes` 确认；print 模式无法交互确认时会跳过执行。

## 支持的接口

| provider | 说明 | 默认 base URL |
|----------|------|---------------|
| `claude` | Anthropic Messages API | `https://api.anthropic.com` |
| `openai` | OpenAI Chat Completions 兼容接口 | `https://api.openai.com/v1` |

`openai` 类型可指向任意 OpenAI 兼容服务，例如：

```bash
murasame --provider openai \
  --base-url https://api.deepseek.com/v1 \
  --model deepseek-chat
```

## 目录结构

```
murasame-code/
├── bin/murasame.js       # CLI 入口
├── src/
│   ├── index.ts          # 参数解析 / 配置 / print 模式
│   ├── config.ts         # 配置读写（~/.murasame/config.json + 环境变量）
│   ├── llm.ts            # Claude / OpenAI 双接口 + 流式 + 工具调用
│   ├── tools.ts          # 工具定义与执行（read/write/edit/bash/grep/glob）
│   ├── prompt.ts         # 系统提示词组装
│   ├── persona.ts        # 丛雨人设入口
│   ├── agent.ts          # Agent 循环（模型 ↔ 工具）
│   ├── errors.ts         # API 错误提示
│   ├── i18n.ts           # i18n 运行时
│   ├── i18n-types.ts     # i18n 类型与常量
│   ├── locales/          # 语言词典（zh / en / ja）
│   ├── ui.tsx            # Ink 交互式终端 UI（丛雨主题）
│   └── theme.ts          # 配色 / ASCII 立绘 / 台词库
├── persona/              # 丛雨人设源文件（Cursor Skill 参考）
├── test/                 # 回归测试
├── package.json
└── tsconfig.json
```

## 开发

```bash
npm run dev        # tsx 直接运行
npm run build      # tsc 编译
npm run typecheck  # 类型检查
npm test           # 回归测试
npm run lint       # ESLint 检查
npm run format     # Prettier 格式化
```

---

