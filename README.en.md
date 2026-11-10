# Murasame Code · murasame

[简体中文](README.md) | **English** | [日本語](README.ja.md)

This project is licensed under the [GNU General Public License v3.0](LICENSE).

> Murasame from Senren＊Banka, in your terminal: an AI coding agent with usage similar to Claude Code.

A full-featured command-line coding agent that can **read files, edit code, run commands, and search files**, keeping you company with Murasame's voice and colors.

```
┌────────────────────────────────────────────────────────┐
│ >_ Murasame Code (v0.1.0)                              │
│                                                        │
│ Claude API Key | [claude] claude-sonnet-4-5            │
│ ~/murasame-code                                        │
└────────────────────────────────────────────────────────┘
```

Interactive mode opens in the terminal's alternate screen and restores the original screen on exit. As the window width changes, the `MURASAME` title switches automatically between large lettering, compact lettering, and plain text to avoid wrapping.

## Features

- 🗡️ **Full agent loop**: Uses `read_file` / `write_file` / `edit` / `bash` / `grep_search` / `glob` tools to complete tasks autonomously, much like Claude Code.
- 🌸 **Murasame theme**: Pale purple and cherry blossom pink colors, with a Senren＊Banka-style banner.
- 🔑 **Bring your own API key**: Supports Anthropic Claude and any OpenAI-compatible endpoint (DeepSeek / Qwen / Kimi / OpenAI …), with a configurable `base_url`.
- 💬 **Interactive REPL** (Ink terminal UI) and **single-shot print mode** for pipes and scripts.

## Installation

Requires Node.js ≥ 18.18.

```bash
cd murasame-code
npm install
npm run build          # Compile to dist/

# Optional: install globally to run murasame directly
npm link
```

## Configure your API key

**Option 1: Interactive setup (recommended)**

```bash
murasame --configure
```

Follow the prompts to select a provider and enter your API key, model name, and base URL.

**Option 2: Command-line settings**

```bash
murasame --set-key sk-xxxx            # Set the API key
murasame --provider openai            # Set the provider (claude / openai)
murasame --model gpt-4o               # Set the model
murasame --base-url https://api.openai.com/v1
```

**Option 3: Environment variables**

```bash
export MURASAME_API_KEY=sk-xxxx
export MURASAME_PROVIDER=openai        # claude or openai
export MURASAME_MODEL=gpt-4o
export MURASAME_BASE_URL=https://api.openai.com/v1
# ANTHROPIC_API_KEY also works for Claude; OPENAI_API_KEY also works for OpenAI
```

Configuration is saved to `~/.murasame/config.json`.

## Usage

```bash
murasame                    # Interactive conversation (REPL)
murasame "Fix this bug"      # Single-shot request; output goes to stdout
murasame -p "Explain this code"    # Explicit print mode
echo "Refactor src/auth.ts" | murasame   # Read from standard input
```

**Interactive commands**

| Command             | Action                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `/help`             | Show help                                                                                     |
| `/clear`            | Clear the conversation context                                                                |
| `/config`           | Reconfigure the API                                                                           |
| `/lang`             | Switch language (zh / en / ja)                                                                |
| `/detail`           | Set command output detail (hidden / command only / command + first three lines / full output) |
| `/model name`       | View or switch the current model                                                              |
| `/cost`             | Show token usage reported by the provider; refer to the provider's bill for exact charges     |
| `/compact`          | Use the current model to summarize and compress the conversation                              |
| `/permission`       | Choose auto, manual, or full access permission mode                                           |
| `/permission reset` | Clear remembered “don't ask again” decisions                                                  |
| `↑` / `↓`           | Browse input history                                                                          |
| `/exit` `/quit`     | Exit                                                                                          |
| `Ctrl+C`            | Cancel the current task (exit when idle)                                                      |

The permission mode is saved to `~/.murasame/config.json`. auto runs ordinary tool calls automatically, but asks for confirmation before dangerous commands such as deletion or a hard reset; manual asks before every tool call; full access never asks. The confirmation menu offers “Yes / No / Yes, and don't ask again for this operation.” The third option applies only to the exact same tool and input in the same working directory. Remembered decisions are stored as hashes, without the original command text. Print mode skips operations that require confirmation when interactive confirmation is unavailable.

## Supported providers

| provider | Description                                 | Default base URL            |
| -------- | ------------------------------------------- | --------------------------- |
| `claude` | Anthropic Messages API                      | `https://api.anthropic.com` |
| `openai` | OpenAI Chat Completions-compatible endpoint | `https://api.openai.com/v1` |

The `openai` provider can point to any OpenAI-compatible service, for example:

```bash
murasame --provider openai \
  --base-url https://api.deepseek.com/v1 \
  --model deepseek-chat
```

## Project structure

```
murasame-code/
├── bin/murasame.js       # CLI entry point
├── src/
│   ├── index.ts          # Argument parsing / configuration / print mode
│   ├── config.ts         # Configuration I/O (~/.murasame/config.json + environment variables)
│   ├── llm.ts            # Claude / OpenAI providers + streaming + tool calls
│   ├── tools.ts          # Tool definitions and execution (read/write/edit/bash/grep/glob)
│   ├── prompt.ts         # System prompt assembly
│   ├── persona.ts        # Murasame persona entry point
│   ├── agent.ts          # Agent loop (model ↔ tools)
│   ├── permissions.ts    # Tool permission modes and remembered decisions
│   ├── errors.ts         # API error messages
│   ├── i18n.ts           # i18n runtime
│   ├── i18n-types.ts     # i18n types and constants
│   ├── locales/          # Language dictionaries (zh / en / ja)
│   ├── ui.tsx            # Ink interactive terminal UI (Murasame theme)
│   └── theme.ts          # Colors / ASCII character art / dialogue library
├── persona/              # Murasame persona source files (Cursor Skill reference)
├── test/                 # Regression tests
├── package.json
└── tsconfig.json
```

## Development

```bash
npm run dev        # Run directly with tsx
npm run build      # Compile with tsc
npm run typecheck  # Type checking
npm test           # Regression tests
npm run lint       # ESLint checks
npm run format     # Format with Prettier
```

## Desktop app and desktop pet

The desktop app combines chat, file editing, and a terminal, with support for multiple sessions. Click the button to minimize to the desktop pet to show Murasame on your desktop; closing the main window keeps the app in the system tray.

```bash
npm run build
npm run desktop       # Launch the desktop app
npm run desktop:pet   # Launch only the desktop pet
npm run build:win     # Build a Windows installer
npm run build:linux   # Build a Linux AppImage
```

The desktop app and CLI share model configuration, permission settings, and default session history. Use `/config` to configure the provider, and type `/` to view session commands. The workspace design takes inspiration from DeepSeek Harness, without depending on its source code or runtime.

- **Files**: Edit code and Markdown, and preview images and PDFs. Includes unsaved-change reminders, protection against external modifications, and per-file restoration of task changes.
- **Office documents**: Edit DOCX, XLSX, CSV, and TSV files up to 25 MB. For complex DOCX layouts, check the result in Word or LibreOffice.
- **Appearance**: Light and dark themes; Chinese, English, and Japanese interfaces; custom avatars, backgrounds, and code area opacity. The desktop pet supports dragging, outfit changes, always-on-top mode, and launch at startup. Assets are bundled with the app.
- **Options**: Language, model, and permission choices use game-style menus: ↑/↓ to select, Enter to confirm, and Esc to close.
- **Shortcuts**: `Ctrl/Cmd+1/2/3` switches between chat, files, and terminal; `Ctrl/Cmd+K` searches files; `Ctrl/Cmd+L` focuses the input box.
