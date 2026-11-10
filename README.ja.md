# ムラサメ Code · murasame

[简体中文](README.md) | [English](README.en.md) | **日本語**

本プロジェクトは [GNU General Public License v3.0](LICENSE) のもとで公開されています。

> ターミナルの中のムラサメ（千恋＊万花）。Claude Code のように使える AI コーディングエージェントです。

**ファイルの読み取り、コードの編集、コマンドの実行、ファイルの検索**を実際に行える、多機能なコマンドライン型コーディングエージェントです。ムラサメの口調とテーマカラーで作業に寄り添います。

```
┌────────────────────────────────────────────────────────┐
│ >_ Murasame Code (v0.1.0)                              │
│                                                        │
│ Claude API Key | [claude] claude-sonnet-4-5            │
│ ~/murasame-code                                        │
└────────────────────────────────────────────────────────┘
```

対話モードはターミナルの代替画面で開き、終了すると元の画面に戻ります。ウィンドウ幅に応じて `MURASAME` のタイトルを大きな文字、コンパクトな文字、通常のテキストへ自動的に切り替え、折り返しを防ぎます。

## 特徴

- 🗡️ **エージェント機能**：`read_file` / `write_file` / `edit` / `bash` / `grep_search` / `glob` のツールを繰り返し使い、Claude Code のようにタスクを自動で進めます。
- 🌸 **ムラサメのテーマ**：淡い紫と桜色の配色、千恋＊万花風のバナー。
- 🔑 **自分の API キーを使用**：Anthropic Claude と OpenAI 互換 API（DeepSeek / Qwen / Kimi / OpenAI など）に対応。`base_url` も変更できます。
- 💬 **対話型 REPL**（Ink ターミナル UI）と、パイプやスクリプトで使える**単発の print モード**。

## インストール

Node.js ≥ 18.18 が必要です。

```bash
cd murasame-code
npm install
npm run build          # dist/ にコンパイル

# 任意：グローバルにインストールすると murasame を直接実行できます
npm link
```

## API キーの設定

**方法 1：対話形式で設定（推奨）**

```bash
murasame --configure
```

案内に従ってプロバイダーを選び、API キー、モデル名、ベース URL を入力します。

**方法 2：コマンドラインで設定**

```bash
murasame --set-key sk-xxxx            # API キーを設定
murasame --provider openai            # プロバイダーを設定（claude / openai）
murasame --model gpt-4o               # モデルを設定
murasame --base-url https://api.openai.com/v1
```

**方法 3：環境変数**

```bash
export MURASAME_API_KEY=sk-xxxx
export MURASAME_PROVIDER=openai        # claude または openai
export MURASAME_MODEL=gpt-4o
export MURASAME_BASE_URL=https://api.openai.com/v1
# Claude では ANTHROPIC_API_KEY、OpenAI では OPENAI_API_KEY も使用可能
```

設定は `~/.murasame/config.json` に保存されます。

## 使い方

```bash
murasame                    # 対話モード（REPL）
murasame "このバグを修正して"   # 単発の実行。結果は標準出力へ
murasame -p "このコードを説明して"    # print モードを明示的に指定
echo "src/auth.ts をリファクタリングして" | murasame   # 標準入力から読み取り
```

**対話モードのコマンド**

| コマンド            | 動作                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `/help`             | ヘルプを表示                                                                               |
| `/clear`            | 会話のコンテキストを消去                                                                   |
| `/config`           | API を再設定                                                                               |
| `/lang`             | 言語を切り替え（zh / en / ja）                                                             |
| `/detail`           | コマンド出力の詳細度を変更（非表示 / コマンドのみ / コマンドと先頭 3 行 / 全文）           |
| `/model モデル名`   | 現在のモデルを確認・変更                                                                   |
| `/cost`             | プロバイダーが返したトークン使用量を表示。正確な料金はプロバイダーの請求を確認してください |
| `/compact`          | 現在のモデルで会話を要約して圧縮                                                           |
| `/permission`       | 権限モードを auto、manual、full access から選択                                            |
| `/permission reset` | 「今後この操作は確認しない」の記録を消去                                                   |
| `↑` / `↓`           | 入力履歴を表示                                                                             |
| `/exit` `/quit`     | 終了                                                                                       |
| `Ctrl+C`            | 実行中のタスクを中止（待機中は終了）                                                       |

権限モードは `~/.murasame/config.json` に保存されます。auto は通常のツール呼び出しを自動実行し、削除や強制リセットなどの危険なコマンドでは確認を求めます。manual はすべてのツール呼び出しで確認し、full access は確認せずに実行します。確認メニューには「はい / いいえ / はい、今後この操作は確認しない」が表示されます。3 つ目の選択肢は、同じ作業ディレクトリでツールと入力が完全に一致する操作にのみ適用されます。記録はハッシュとして保存され、元のコマンド文字列は保存されません。print モードで対話的な確認ができない場合、確認が必要な操作はスキップされます。

## 対応プロバイダー

| provider | 説明                             | 既定のベース URL            |
| -------- | -------------------------------- | --------------------------- |
| `claude` | Anthropic Messages API           | `https://api.anthropic.com` |
| `openai` | OpenAI Chat Completions 互換 API | `https://api.openai.com/v1` |

`openai` は任意の OpenAI 互換サービスに接続できます。例：

```bash
murasame --provider openai \
  --base-url https://api.deepseek.com/v1 \
  --model deepseek-chat
```

## ディレクトリ構成

```
murasame-code/
├── bin/murasame.js       # CLI エントリーポイント
├── src/
│   ├── index.ts          # 引数の解析 / 設定 / print モード
│   ├── config.ts         # 設定の読み書き（~/.murasame/config.json + 環境変数）
│   ├── llm.ts            # Claude / OpenAI 対応 + ストリーミング + ツール呼び出し
│   ├── tools.ts          # ツールの定義と実行（read/write/edit/bash/grep/glob）
│   ├── prompt.ts         # システムプロンプトの組み立て
│   ├── persona.ts        # ムラサメのペルソナのエントリーポイント
│   ├── agent.ts          # エージェントループ（モデル ↔ ツール）
│   ├── permissions.ts    # ツールの権限モードと確認結果の記録
│   ├── errors.ts         # API エラーメッセージ
│   ├── i18n.ts           # i18n ランタイム
│   ├── i18n-types.ts     # i18n の型と定数
│   ├── locales/          # 言語辞書（zh / en / ja）
│   ├── ui.tsx            # Ink 対話型ターミナル UI（ムラサメのテーマ）
│   └── theme.ts          # 配色 / ASCII 立ち絵 / セリフ集
├── persona/              # ムラサメのペルソナのソース（Cursor Skill 参考）
├── test/                 # 回帰テスト
├── package.json
└── tsconfig.json
```

## 開発

```bash
npm run dev        # tsx で直接実行
npm run build      # tsc でコンパイル
npm run typecheck  # 型チェック
npm test           # 回帰テスト
npm run lint       # ESLint チェック
npm run format     # Prettier で整形
```

## デスクトップアプリとデスクトップマスコット

デスクトップアプリはチャット、ファイル編集、ターミナルを統合し、複数のセッションを管理できます。マスコットに切り替えるボタンをクリックすると、デスクトップにムラサメが表示されます。メインウィンドウを閉じても、アプリはシステムトレイに常駐します。

```bash
npm run build
npm run desktop       # デスクトップアプリを起動
npm run desktop:pet   # マスコットのみを起動
npm run build:win     # Windows インストーラーを作成
npm run build:linux   # Linux AppImage を作成
```

デスクトップアプリと CLI は、モデル設定、権限設定、既定のセッション履歴を共有します。`/config` で API を設定し、`/` を入力するとセッション用のコマンドを確認できます。ワークスペースのデザインは DeepSeek Harness を参考にしていますが、そのソースコードやランタイムには依存しません。

- **ファイル**：コードや Markdown を編集し、画像や PDF をプレビューできます。未保存の変更の通知、外部変更による上書きの防止、タスクによる変更のファイル単位での復元に対応します。
- **オフィス文書**：最大 25 MB の DOCX、XLSX、CSV、TSV を編集できます。複雑な DOCX のレイアウトは Word または LibreOffice での確認を推奨します。
- **外観**：ライト・ダークテーマ、中国語・英語・日本語の UI、アバター・背景・コード領域の不透明度のカスタマイズに対応します。マスコットはドラッグ、着せ替え、最前面表示、自動起動が可能で、素材はアプリに同梱されています。
- **選択メニュー**：言語、モデル、権限などはゲームの選択肢風に表示されます。↑/↓ で選択、Enter で決定、Esc で閉じます。
- **ショートカット**：`Ctrl/Cmd+1/2/3` でチャット・ファイル・ターミナルを切り替え、`Ctrl/Cmd+K` でファイル検索、`Ctrl/Cmd+L` で入力欄にフォーカスします。
