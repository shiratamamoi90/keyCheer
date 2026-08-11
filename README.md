# KeyCheer ⌨️🎉

キー押下数・打鍵速度に応じて、自分で設定したキャラクターが音声とポップアップで応援してくれる Windows デスクトップアプリ。応援発動はアプリ単体(オフライン)で完結する。

## 特徴

- 🎯 設定した回数キーを押す・打鍵速度に応じて応援
- 🗣️ ローカルAI(Ollama)が応援メッセージを生成(キャラ作成時に一括生成してプール化)
- 🔊 ローカルTTS(VOICEVOX)でキャラの声を事前合成(wav をプールと一緒に保持)
- 🎨 キャラの名前・性格・口調・画像をカスタマイズ(画像は stable-diffusion.cpp で AI 生成も可)
- 🎭 キャラ作成時の生成はローカル/外部 API(OpenAI・Anthropic・ElevenLabs 等)をプロバイダーとして選択可能
- 🔌 初回セットアップ(モデル取得)のみオンライン、以降は完全オフライン。外部送信はキャラ作成時に明示同意した場合のみ。入力内容は記録・送信しない

## このリポジトリの現在の状態

- **engine(決定的コア)**: TDD 実装済み(カウント / アクティブ時間 / KPM / 速度ゾーン / トリガー / timeOfDay / プール選択 / baseline 定型文 / プロバイダー型契約・同意状態 / hasCharacter 判定)。
- **agent(生成 I/O)**: プロバイダー実装済み(ローカル: Ollama / VOICEVOX / sd.cpp、外部: OpenAI text・TTS・DALL·E / Anthropic / ElevenLabs / Stability AI)、プール一括生成・全文事前合成・監査ログ・API キー(safeStorage)・再生計画。
- **main(Electron)**: 発動経路の配線済み(キーフック → engine → ポップアップ IPC・履歴記録、設定の読み込み/検証/移行、統計の定期 flush、トレイ、ウィンドウ)。メインウィンドウの開閉ライフサイクル(キャラ未作成時の起動時自動表示、トレイからのトグル、閉じる時の確認ダイアログ)も実装済み。
- **renderer / preload**: 応援ポップアップと preload API まで実装済み。メインウィンドウに**キャラ作成フォーム**(名前・性格・話者の入力と検証、VOICEVOX からの話者一覧取得、プロフィール保存)と、**プール生成の起動・進捗・中断 UI** を実装済み。
- **プール・wav の生成と永続化**: 実装済み。保存とは別の「生成」ボタンから Ollama → VOICEVOX を順に呼び、`pool.json` と wav を `{userData}` 配下に永続化する。起動時に読み込んで発動に紐付ける。
  → `npm run build` → `npm run dev` で、**フォーム入力 → ローカル生成 → 打鍵すると生成した文言と声で応援される**縦の 1 本が通る。
- **未実装**: 設定・統計 UI、同意ダイアログ、キャラ画像生成、**初回セットアップ画面**(モデル重みの取得。ADR 0010)、配布インストーラ(electron-builder)。
  プール未生成の状態では応援文言は同梱 baseline 定型文、音声は再生されない(`wavPath` が null)。

このセクションがリポジトリの状態の正本。実装が進んだらここを更新する。

## セットアップ

```bash
npm install       # 依存導入(バージョンは package-lock.json で固定)
npm run build     # tsc -p tsconfig.build.json → scripts/postbuild.mjs
npm run dev       # build 後に electron dist/main/index.js を起動
```

環境は Windows(開発は WSL2 可)。iGPU/CPU でも動く構成。

### 生成ランタイム(現状は各自で用意)

キャラ作成には Ollama(:11434)と VOICEVOX ENGINE(:50021)が要る。
**ADR 0010 でランタイムは同梱・モデル重みは初回取得と決めたが、その仕組みはまだ未実装**のため、
現時点では手元で別途起動しておく必要がある。エンドポイントは `system` 設定
(`ollamaEndpoint` / `voicevoxEndpoint`)で上書きできる。
未起動でもアプリはクラッシュせず、baseline 定型文で応援する。

### 日本語入力(WSL で開発する場合のみ)

WSLg は Windows の IME を Linux アプリへ渡さないため、**WSL 内に IME を入れないと
キャラ作成フォーム(名前・性格)に日本語を打ち込めない**。Windows 実機では OS の IME が
そのまま効くので、この手順は WSL 開発時だけのもの。

```bash
sudo apt install -y fcitx5 fcitx5-mozc   # 初回のみ
fcitx5 -d                                # ログインごとに 1 回
```

環境変数(`~/.profile` に置く。設定後は WSL を再起動するか、`source ~/.profile` してから起動する):

```bash
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
```

Electron は WSLg 上で X11(XWayland)として動くため、IME は XIM 経由で繋がる。
Wayland で動かす場合のみ `--enable-wayland-ime` が別途要る(現状は不要)。

### コマンド

| コマンド             | 内容                                                          |
| -------------------- | ------------------------------------------------------------- |
| `npm test`           | Vitest(`tests/**/*.test.ts`)                                  |
| `npm run test:watch` | Vitest watch                                                  |
| `npm run typecheck`  | `tsc --noEmit`                                                |
| `npm run lint`       | ESLint(engine の依存方向違反の検出を含む)                     |
| `npm run format`     | Prettier                                                      |
| `npm run build`      | `dist/main/index.js`・`dist/preload/index.mjs`・`dist/renderer/` を出力(バンドラは使わない) |
| `npm run dev`        | build 後に Electron 起動                                      |
| `npm run eval`       | 応援メッセージの品質・レイテンシ計測(スタブ)                  |

## ディレクトリ構造

```
.
├── src/                            # 依存方向 engine←agent←eval
│   ├── engine/                     #   決定的・安定:カウント/KPM/ゾーン/トリガー/プール選択
│   ├── agent/                      #   非決定的 I/O:プロバイダー実装・プール生成・事前合成
│   ├── main/                       #   Electron メイン:配線・キーフック・store・IPC・窓/トレイ
│   ├── preload/                    #   レンダラに公開する最小 API
│   ├── renderer/                   #   応援ポップアップ UI
│   ├── shared/                     #   main/renderer/engine 共有の型と IPC チャンネル契約
│   └── eval/                       #   メッセージ品質・レイテンシ計測
├── tests/                          # engine/agent/main/preload/renderer/shared の決定的シナリオ
├── specs/                          # 決定的な振る舞いの source of truth
│   ├── key-counter.md              #   キーカウント・アクティブ時間(既定60秒・設定可)
│   ├── speed-zone.md               #   KPM 算出(60秒固定窓)・速度ゾーン分類
│   ├── cheer-trigger.md            #   通常/マイルストーン発動・プール選択
│   ├── time-of-day.md              #   時(0..23)→ morning/afternoon/evening/night
│   ├── data-model.md               #   設定/プール/統計/ランタイムのデータ契約
│   └── integrations.md             #   生成プロバイダー(ローカル/外部API)の決定的契約
├── decisions/                      # ADR:設計判断の記録
├── docs/                           # 補足ドキュメント
└── scripts/postbuild.mjs           # ビルド後処理(preload/renderer の配置)
```

## 設計の不変条件

- **依存方向は一方向**: `src/engine`(決定的)← `src/agent`(プロバイダー)← `src/eval`(評価)。
  engine は agent / eval / Electron / fetch を import しない。ESLint で強制する。
- **応援発動経路はプロバイダーに依存しない**: 発動はプール + wav のみで成立し、`providers` 設定やプロバイダー実装を import しない。
- **KPM 算出窓は 60 秒固定**(`triggers.activeThresholdSec` とは独立)。
- **再現性**: 乱数シード(画像生成 seed、メッセージ選択)と依存バージョンを固定する。
- **フォールバック**: Ollama / VOICEVOX / sd.cpp が未起動でもクラッシュせず、baseline 定型文で応援する。

## プライバシー方針(絶対の制約)

- キーフックは**キーの種類のみカウント**。入力内容・キーシーケンスは記録・送信しない。
- キーカウント・KPM・統計・**応援発動経路**は**永久に外部送信しない**(localhost 含む一切のサーバー通信なし)。
- 外部送信はキャラ作成時に限り、UI で外部プロバイダーを明示選択し同意ダイアログを通過した場合のみ。
- 外部送信は `{userData}/audit.log.json`(統計とは別ファイル)に記録する。
- API キーは Electron `safeStorage`(Windows Credential Manager)に置き、平文 JSON・`.env` には出さない。

## 開発の進め方

決定的な部分(カウント/KPM/速度ゾーン/トリガー/データ契約)は **仕様 → テスト → 実装 → テスト** で進め、
確定した仕様は `specs/` に、設計判断は `decisions/` に残す。応援文言・画像の「良さ」など指標でしか測れない部分は
テストで縛らず、計測して判断する(`npm run eval`)。

> エージェント運用のためのルール・スキル・作業フォルダ(`.claude/`, `CLAUDE.md`, `changes/`, `experiments/`, `baselines/`, `scripts/validate.sh`)は
> ローカル専用で、このリポジトリには含めていない。
