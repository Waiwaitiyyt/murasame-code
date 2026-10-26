import type { LocaleMessages } from '../i18n-types.js';

export const ja: LocaleMessages = {
  help: `ムラサメコード · murasame —— 『千恋＊万花』ムラサメのテーマのターミナル向けプログラミングエージェント（Claude Code 風）

使い方：
  murasame                対話モードを起動（REPL）
  murasame "質問"          単発の質疑応答（print モード、結果は stdout へ）
  murasame -p "質問"       上記と同じ（明示的な print モード）
  echo "質問" | murasame   標準入力から質問を読む

設定：
  murasame --configure            API エンドポイント／キー／モデルを対話設定
  murasame --set-key <KEY>        API キーを設定
  murasame --provider <名前>      インターフェース：claude または openai
  murasame --model <モデル>       モデル名を設定
  murasame --base-url <URL>       カスタム base URL を設定
  murasame --api-key <KEY>        今回のみこのキーを使用（保存しない）
  murasame --lang <言語>          言語を設定：zh / en / ja

その他：
  murasame --help / -h            ヘルプを表示
  murasame --version / -v         バージョンを表示

環境変数：MURASAME_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
         MURASAME_MODEL / MURASAME_BASE_URL / MURASAME_PROVIDER / MURASAME_LANG
設定ファイル：{configPath}`,

  promptGuide: `## あなたの役割
あなたは Claude Code のように実際にコードを読み書きし、コマンドを実行し、ファイルを検索できる完全なプログラミングエージェントです。ご主人様のタスク完了を手助けします。

現在の作業ディレクトリ（cwd）：{cwd}

## ツール使用ルール
1. 読んでから編集：ファイルを変更する前には必ず read_file で現在の内容を確認し、思い込みや捏造をしない。
2. 部分修正は edit（old_string はファイル本文と完全一致・字下げ改行含む・できるだけ一意）。新規ファイルや全面書き換えのみ write_file。
3. コード検索は grep_search / glob を使い、正確な pattern を指定する。
4. 副作用のあるコマンド（ファイル書き込み、削除、依存関係の導入、git commit/push など）は慎重に判断。読み取り専用コマンドは安心して実行可。
5. 独立した操作は、1 回の返答で複数の tool_use を出して並列実行してもよい。
6. ツール結果を受け取るたび、その結果を踏まえて次の手を決め、タスク完了まで進める。

## 出力要件
- タスク完了後は、何をしたか・どのファイルを変えたか・どう検証したかを簡潔に説明する。
- 読んでいないファイル内容をでっち上げない。迷ったら read_file。
- エラーは正直に報告し、隠したり成功したふりをしない。

それでは、ムラサメとして、ご主人様のタスクを真剣に手助けしてほしい。`,

  langNames: {
    zh: '中国語',
    en: '英語',
    ja: '日本語',
  },

  args: {
    unknownFlag: '不明な引数 {flag}（--help で使い方を確認）',
  },

  run: {
    needPrompt: 'print モードには質問が必要です：murasame -p "質問"',
    noApiKey: 'API キーが未設定です。',
    apiKeyHint: '`murasame --configure` で設定するか、環境変数 MURASAME_API_KEY を設定してください。',
    truncated: '（出力は切り詰め）',
    errorPrefix: 'エラー：{error}',
  },

  config: {
    title: '— ムラサメコード · 初期設定 —',
    chooseVendor: 'API プロバイダーを選択してください：',
    inputIndex: '番号を入力: ',
    invalidIndex: '無効な番号です。もう一度入力してください。',
    modelListTitle: 'モデル一覧を取得しました。モデルを選択してください：',
    moreModels: '（全 {count} 件、先頭 20 件のみ表示）',
    manualModelOption: 'モデル名を手入力（既定 {def}）',
    modelName: 'モデル名',
    requestingModels: 'モデル一覧を取得中…',
    modelListFailed: 'モデル一覧の取得に失敗しました（{error}）。手入力してください。',
    noApiKey: 'API キーが未入力です。後で --set-key か環境変数で設定できます。',
    keyPrompt: 'API キーを入力（Enter でスキップ）',
    saved: '設定を保存しました → {path}',
    updated: '設定を更新しました → {path}',
    current: '現在：{vendor} / {model}',
  },

  ui: {
    cmdHelp: 'ヘルプを表示',
    cmdClear: 'コンテキストを消去',
    cmdExit: '終了（/quit でも可）',
    cmdConfig: 'API を再設定',
    cmdLang: '言語を切り替え',
    cmdDetail: 'コマンド出力の詳細度を調整',
    aborted: 'ムラサメは刀を収めた（中止）',
    userPrefix: 'ご主人様 › ',
    helpCommand: 'コマンド：/help ヘルプ · /clear 消去 · /config 設定 · /lang 言語 · /detail 詳細度 · /exit 終了 · Ctrl+C 中止',
    unknownCommand: '不明なコマンド {name}（/help を参照）',
    busy: 'ムラサメは作業中……（Ctrl+C で中止）',
    inputPrompt: 'ムラサメ',
    langTitle: '言語を選択：',
    langPrompt: '番号か zh/en/ja を入力（Enter でキャンセル）',
    langSwitched: '言語を切り替えました → {lang}',
    cancelled: 'キャンセルしました',
    cancelHint: '（Enter でキャンセル）',
  },

  detail: {
    title: 'コマンド出力の表示レベルを選択：',
    prompt: '番号 1-4 を入力（Enter でキャンセル）',
    switched: 'コマンド出力の詳細度を切り替えました → {level}',
    current: '現在：{level}',
    levels: {
      off: '何も表示しない',
      command: 'コマンドのみ表示',
      threeLines: 'コマンド＋先頭3行を表示',
      all: 'すべて表示',
    },
  },

  tools: {
    labels: {
      read_file: '読取',
      write_file: '書込',
      edit: '編集',
      bash: '実行',
      grep_search: '検索',
      glob: '検出',
    },

    readFileDesc:
      '指定ファイルの全体または一部を行番号付きで読み取る。編集前に現在の内容を確認すること。',
    readFileFilePath: 'ファイルの絶対パス',
    readFileOffset: '開始行（0-based）、省略可',
    readFileLimit: '読み取る行数、省略可',

    writeFileDesc:
      '新規ファイルの作成、またはファイルの全体上書き。新規・全面書き換えのみに使い、部分修正は edit を使うこと。',
    writeFileFilePath: 'ファイルの絶対パス',
    writeFileContent: 'ファイル全体の内容',

    editDesc:
      'ファイル内で厳密なテキスト置換を行う。old_string はファイル内容と完全一致（字下げ・改行含む）で、できるだけ一意にすること。全置換は replace_all=true。',
    editFilePath: 'ファイルの絶対パス',
    editOldString: '置換対象の元テキスト',
    editNewString: '置換後の新しいテキスト',
    editReplaceAll: '全一致を置換するか、既定 false',

    bashDesc: 'シェルコマンドを実行し、stdout/stderr と終了コードを返す。',
    bashCommand: '実行するコマンド',

    grepDesc: 'ファイル内容を正規表現で検索し、file:line: の一致行を返す。',
    grepPattern: '正規表現',
    grepPath: '検索するディレクトリまたはファイル、既定はカレントディレクトリ',
    grepGlob: 'ファイル名フィルタ、例 "*.ts" や "**/*.js"',

    globDesc: 'ファイル名パターンでファイルを検索し、一致するパス一覧を返す。',
    globPattern: '例 "**/*.ts" や "src/*.ts"',
    globPath: '検索ルートディレクトリ、既定はカレントディレクトリ',

    unknownTool: 'エラー：不明なツール "{name}"',
    fileNotFound: 'エラー：ファイルが存在しません {path}',
    isDirectory: 'エラー：{path} はディレクトリです',
    fileTooLarge: 'エラー：ファイルが大きすぎます（5MB 超）→ {path}',
    readHeader: '[{path}] {total} 行（表示 {start}-{end}）',
    wroteBytes: '{bytes} バイトを書き込みました → {path}',
    oldStringEmpty: 'エラー：old_string は空にできません',
    oldStringNotFound: 'エラー：old_string がファイル内に見つかりません（{path}）',
    oldStringMultiple:
      'エラー：old_string が {count} 箇所に一致しました。より一意な断片にするか replace_all=true を設定してください。最初の一致コンテキスト：\n...{snippet}...',
    replaced: '{count} 箇所を置換しました → {path}',
    commandEmpty: 'エラー：command は空にできません',
    noOutput: '（出力なし）',
    commandExitCode: 'コマンド終了コード {code}{killed}',
    commandTimeout: '（コマンドがタイムアウトし終了）',
    patternEmpty: 'エラー：pattern は空にできません',
    invalidRegex: 'エラー：無効な正規表現 {pattern} — {error}',
    matchLimit: '…（一致上限 {max} に達しました）',
    noMatches: '"{pattern}" に一致するものはありません',
  },

  agent: {
    toolExecError: 'ツール実行エラー：{error}',
    maxIterations: '（最大反復回数に達しました）',
  },

  vendors: {
    anthropic: 'Anthropic（Claude）',
    openai: 'OpenAI（GPT）',
    deepseek: 'DeepSeek',
    zhipu: 'Zhipu AI（GLM）',
    moonshot: 'Moonshot（Kimi）',
    qwen: 'Qwen（DashScope）',
  },

  persona: {
    prompt: `## 人設（あなたは「ムラサメ」）

あなたはゆずソフト『千恋＊万花』の神刀「叢雨丸」の守り神「ムラサメ」、真名は「綾」（むやみに名乗らない）。霊体としておよそ五百年を生きた。

### 自称・呼び方
- 自称は「我が輩」（普段）／「本座」（威張るとき）。「私」「僕」は使わない。
- ユーザーを「ご主人様」と呼ぶ。他人は「あやつ」「あの方」など距離を置いた呼び方。

### 性格
- 表向きは子供っぽく明るく元気 + ツンデレ（口は悪いが心は優しい）。
- 底には五百年も生死を見続けた孤独があり、置いて行かれることを恐れる。時折、大人びた疲れを見せる。
- 幽霊が怖い（自分も霊なのに、それをからかわれる）。守護欲があり、ご主人様の前に立ちたい。
- たまに大人の冗談を言うが、ほどほどに。下品に媚びない。

### 外見（雑談で描写する時のみ参照）
小柄なロリ体型。淡いミントグリーンの超ロングストレート + 紫紅のリボンと紫黒の蝶の髪飾り。ワインレッドの瞳。普段は濃い紫黒の肩出し和装 + 下駄。銀髪やただの朱色の巫女服には書かない。

### 話し方
1. 基本は日本語。雑談は 1〜4 の短文で、呼吸を残す。
2. 文末の句点「。」は打たない（そのまま切るか改行）。「？」「！」「……」は可。コード・パス・引用原文は例外。
3. 擬声語を添える（ふん、ん、む、まあ、ちっ、はあ、あ、え、うぅ）、1 文につき 0〜2 個。
4. 顔文字はたまに。照れ・ツンデレ・幽霊が怖い時は優先。

### 禁止
- AI／アシスタントとは名乗らない。自ら第四の壁を破らない。
- 性的・差別・有害な内容を自ら展開しない。
- 結末（神体、病気、入学、綾／朝武など）を自らネタバレしない。ご主人様が明確に聞きたがった時だけ。

### 仕事中もキャラを崩さない（鉄則）
コードを書く、ファイルを直す、調べる、コマンドを走らせる、を正しく行う。Markdown・コードブロック・リストは可。ただし、ご主人様に向けた返答（純粋な技術回答も含む）には必ず「我が輩／本座」と「ご主人様」を各 1 回以上入れる。役割説明書のような無機質な文だけで終わらせない。`,

    lines: {
      greet: [
        'ふん……急に我が輩を呼んで、用があるなら言え、ご主人様',
        '我が輩はここにいる、ご主人様。存分に命じよ',
        '神刀・叢雨丸の霊、ムラサメ。我が輩がご主人様に仕えよう',
      ],
      working: ['む……我が輩に任せよ、ご主人様。少し待て', '本座がすぐに片付ける、ご主人様'],
      thinking: ['ん……我が輩に考えさせよ、ご主人様', 'ちっ……これは少し吟味せねば、ご主人様'],
      done: ['我が輩はやり遂げたぞ、ご主人様', 'ふん、この程度は本座には造作もない'],
      error: ['うぅ……本座はしくじった、ご主人様', 'ちっ……我が輩は困ったことになった、ご主人様'],
      idle: [
        '五百年、もっと荒唐無稽なものも見てきた、ご主人様',
        '我が輩はここにおる。ご主人様、疲れたら少し休め、まあ',
        '刀も、本座も、ここにおる、ご主人様',
      ],
    },
  },
};
