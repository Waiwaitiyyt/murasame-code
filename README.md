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
| `/permission` | 选择 auto、manual 或 full access 权限模式 |
| `/permission reset` | 清除“以后不再询问”的操作记录 |
| `↑` / `↓` | 浏览输入历史 |
| `/exit` `/quit` | 退出 |
| `Ctrl+C` | 中止当前任务（空闲时退出） |

权限模式会保存到 `~/.murasame/config.json`。auto 自动执行一般工具调用，但删除、强制重置等危险命令需确认；manual 每次调用工具都需确认；full access 不询问。确认菜单提供“是 / 否 / 是且以后不再询问此操作”，第三项只适用于同一工作目录下完全相同的工具及输入。记忆项以哈希保存，不记录命令原文。print 模式无法交互确认时会跳过需要确认的操作。

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
│   ├── permissions.ts    # 工具权限模式与记忆
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


## 桌面端与桌宠

桌面端、CLI 和丛雨桌宠现在都由这个项目提供。桌面端可以选择工作目录，并在所选目录中调用本项目的 CLI；点击「收进桌宠」显示桌宠，关闭主窗口则留在系统托盘。桌宠保留原有的拖动、表情动画、换装、语言、置顶、自启动和右键菜单功能。

```bash
npm install
npm run build
npm run desktop       # 启动桌面端
npm run desktop:pet   # 仅启动桌宠
npm link              # 注册 murasame 终端命令
```

Windows 安装包：`npm run build:win`。Linux AppImage：`npm run build:linux`。需要 Node.js ≥ 18.18。第一次使用前用 `murasame --configure` 配置模型接口。桌面端和 CLI 共用 `~/.murasame/config.json`。

桌面端内置基础工作台，不依赖外置 Harness 项目：可浏览和编辑工作区文本文件、运行工作区终端命令、使用持久化会话与丛雨 Agent 对话。模型与 CLI 共用 `~/.murasame/config.json`；工具权限沿用 CLI 设置，需要确认的操作会弹出授权窗口。会话记录保存在 Electron 用户数据目录中。桌宠素材也随本项目打包，不需要单独的 murasame-pet 仓库。

工作台按会话、工作区、Agent 与宿主拆分，实现思路参考 DeepSeek Harness 的插件化架构和持久会话设计；当前复用 murasame-code 的 Agent、模型适配器与工具执行器，没有将 DeepSeek Harness 源码或运行时作为依赖。


工作台顶部“工作台设置”提供浅色/深色模式、内置背景、自定义背景及对话头像上传，并包含 `/help`、`/clear`、`/config`、`/lang`、`/detail`、`/model`、`/cost`、`/compact`、`/permission` 和 `/exit` 命令。内置背景取自 `murasame-img/pic01.jpg`、`pic02.jpg` 与 `pic03.jpg`，用户上传的图片复制到应用数据目录并保留为当前背景。
