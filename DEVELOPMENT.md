# 開発ガイド:keyCheer(アプリの名前は TypeYell)

> **名前**:利用者に見えるアプリの名前は **TypeYell**(タイプエール)。プロジェクトの名前は **keyCheer** のまま(リポジトリ・npm の名前 `keycheer`・IPC の名前・ログの先頭 `[keycheer]`)。
> データの置き場 `{userData}` も前の版と同じ `keycheer`(Windows は `%APPDATA%\keycheer`、Linux は `~/.config/keycheer`)。名前の値は `src/core/shared/appIdentity.ts` と `package.json` の `productName`(論点 0077)。
> アイコンは `assets/icon.png`(512×512 以上の正方形の PNG)。置くと窓・トレイ・インストーラ(`package.json` の `build.win.icon`)が使う。

このリポジトリで**開発・改修する人**のための文書。ソフトの導入と使い方は [README.md](README.md)。

## 開発環境のセットアップ

README.md の「動作環境」に**加えて**必要なもの。

```bash
npm install       # 依存導入(バージョンは package-lock.json で固定)
npm run build     # tsc -p tsconfig.build.json → scripts/postbuild.mjs → Tailwind の CLI(build:css)
npm run dev       # build 後に electron dist/main/index.js を起動
```

### ローカル生成ランタイム(Ollama / VOICEVOX)

キャラ作成の生成に要る。**Docker で起動する**(論点 0023)。`compose.yaml` が正本。

```bash
npm run services:up      # CPU で Ollama(:11434)と VOICEVOX(:50021)を起動
npm run services:model   # sarashina2.2-3b-instruct を取り込む(初回のみ。約 6.7 GB を取得し、取り込み後に削除。論点 0029)
npm run weights:text -- ~/.config/keycheer/weights/text   # 取り込んだ GGUF をアプリの置き場へ(論点 0059 / 0074)
npm run services:status  # 稼働確認
npm run services:down    # 停止
```

- **アプリは生成を始めるたびに、置き場のテキストモデル(GGUF)を sha256 で照合する**(論点 0059)。置き場に無ければ
  生成を始めない。開発機では上の `weights:text` で置く。Windows 実機では取り出した GGUF を
  `%APPDATA%\keyCheer\weights\text\` にコピーする(インストーラができるまで)。
- **既定は CPU。** 製品ターゲットが iGPU/CPU なので、開発機の GPU で速さに慣れないようにする。
  GPU で回したいときだけ `docker compose --profile gpu up -d`。
  **cpu と gpu を同時に起動しない**(同じポートを公開するので衝突する。先に `services:down`)。
- **これは開発機だけの構成。** 配布物は論点 0010 のとおりランタイムを同梱し、重みも別ファイルとして一緒に配る(論点 0055)。
  **利用者に Docker は要求しない。**
- イメージはタグ + digest で固定してある。更新するときは digest も取り直す(固定しないと再現できない)。
- 起動していなくても**アプリはクラッシュしない**。キャラ作成が完了しないだけで、
  応援は同梱 baseline 定型文で出る。

参考(この構成での実測。CPU / 16 コア):1 バケット 8 文の生成が約 10 秒(上限 60 秒)、
プール 24 バケットで約 4 分、wav 1 文の合成が約 0.6 秒。

- 依存はバージョンを固定する(`package-lock.json`)。固定しないと再現できない。
- `.env` はコミットしない。必要な環境変数:無し(外部プロバイダーは論点 0054 で削除したので API キーも無い)。
- 開発は Windows 実機のほか WSL2 でも可。

### WSL で開発する場合の日本語入力

WSLg は Windows の IME を Linux アプリへ渡さないため、**WSL 内に IME を入れないと
キャラ作成フォーム(名前・性格)に日本語を打ち込めない**。Windows 実機では OS の IME が
そのまま効くので、この手順は WSL 開発時だけのもの。

```bash
sudo apt install -y fcitx5 fcitx5-mozc   # 初回のみ
fcitx5 -d                                # ログインごとに 1 回
```

環境変数(`~/.profile` に置く。設定後は WSL を再起動するか `source ~/.profile` してから起動する):

```bash
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
```

Electron は WSLg 上で X11(XWayland)として動くため、IME は XIM 経由で繋がる。
Wayland で動かす場合のみ `--enable-wayland-ime` が別途要る(現状は不要)。

### Windows 実機で確かめる(WSL2 でビルドする)

キーフック(uiohook-napi)は WSLg では Windows の打鍵を拾えないので、応援の発動は Windows 実機で確かめる。
ビルドは WSL2 で行い、展開済みフォルダを Windows 側へ置く(論点 0025)。

```bash
npm run services:up    # Ollama / VOICEVOX(WSL2 のコンテナ)
npm run deploy:win     # build → electron-builder --win --dir → Windows の「ドキュメント\keyCheer」へコピー
```

Windows で `ドキュメント\keyCheer\keycheer.exe` を実行する。

- 接続先は既定の `127.0.0.1` のままでよい。Windows のアプリから WSL2 のコンテナの :11434 / :50021 に届く。
- 置き場を変えるときは `KEYCHEER_WIN_DEPLOY_DIR=/mnt/c/... npm run deploy:win`。
- Windows 側でアプリが起動したままだとコピーに失敗する。終了してから再実行する。
- 古いファイルは消さずに上書きする。きれいにしたいときは Windows 側でフォルダを消してから実行する。
- インストーラ(NSIS)はここでは作らない(wine が要る。論点 0010 / 0031)。

## テスト

```bash
npm test                                   # 全テスト。変更を閉じる前に必ず通す
npx vitest run tests/core tests/agent tests/main tests/preload tests/renderer tests/eval tests/installer  # 単体だけ
npx vitest run tests/integration           # 総合だけ
npm run typecheck                          # tsc --noEmit
npm run lint                               # ESLint(依存方向・発動経路の分離を検出)
bash scripts/validate.sh                   # 要件 ↔ テストの整合(機械検査)
```

単体と総合の**両方**を書く。単体は「部品が仕様どおりか」、総合は「繋いだ経路が動くか」を守る。
応援文言・画像の良し悪しはテストで縛らない(指標で測るものは非決定的な論点の `result.md` 側)。

総合テストは `tests/integration/` に2本ある(`cheerFlow` = キー押下から応援表示までの縦 1 本、
`settingsFlow` = 設定更新の反映経路)。総合テストにはシナリオ ID を付けない(経路を見るものなので)。

## ディレクトリ構造

パスの役割とレイヤー(Core/Scale/Adapt)はこのツリーが正本。**同じ一覧を別の表で持たない**
(2箇所あると片方が古いまま残る)。**src / tests の配置は Electron/TypeScript の慣習に合わせて
差し替えてある**(層とディレクトリの対応は `.claude/rules/stack.md`「レイヤーとディレクトリ」)。

```
.
├── CLAUDE.md                       # エージェントへのルール/制約のみ(git 非追跡 / Core)
│                                   #   「このリポジトリの現在の状態」が進捗の正本
├── README.md                       # **使用者向け**:導入と使い方。開発の話は書かない(git 追跡)
├── DEVELOPMENT.md                  # このファイル。**開発者向け**:構成・テスト・進め方(git 追跡)
├── .gitignore                      # 追跡範囲の正本(4区分の除外)
├── .npmrc                          # onnxruntime-node のインストール時のスクリプト(CUDA 版の取得)を止める(論点 0066)
├── .claude/
│   ├── settings.json               # hooks の配線: format on edit, test on stop(Core)
│   ├── settings.team.json          # チーム用 hooks の配線: veto, validate(Scale, マージで有効化)
│   ├── rules/                      # ルールの正本8本(どれを見るかは CLAUDE.md の参照先表 / Core)
│   └── skills/                     # new-topic / decide / new-work / run-loop / validate / where(実行 / Core)
├── decisions/                      # 議論と決定の記録。状態をフォルダで表す(Core)
│   ├── undecided/                  #   未決定:論点ごとに topic.md(+ 非決定的なら config/result)
│   └── decided/                    #   決定済み 0001〜0020:決定 + 理由 + 却下案 + 反映先
├── docs/                           # 統合先:決定済みの要件(何を満たすか / Core)
│   ├── overview.md                 #   要件ファイルと論点番号の対応
│   ├── glossary.md                 #   用語集:ドメイン語彙の「正」(N-1。validate.sh が参照)
│   └── *.md                        #   要件本体。見出しは `### S<論点4桁>_<連番2桁> <名前>`
├── work/                           # 反映作業の単位。**git 追跡外**(Core)
├── src/                            # 依存方向 core ← app(Core/Adapt)
│   ├── core/                       #   決定的・安定。純関数中心(仕様ループ対象)
│   │   └── shared/                 #   型・IPC チャンネル契約・開示情報(core も app も参照する)
│   ├── agent/                      #   app: 生成 I/O(プロバイダー実装・プール生成)
│   ├── main/                       #   app: Electron メイン(キーフック・IPC・store・窓・トレイ)
│   ├── preload/  renderer/         #   app: レンダラに公開する最小 API と UI
│   │   ├── renderer/*.tsx          #   メインウィンドウ(JSX。tsc が React.createElement に変換。バンドラ無し。論点 0079):
│   │   │                           #   mainEntry(タブと根)・characterScreen / switchScreen / settingsScreen・imagePanel・ui(部品)
│   │   └── renderer/styles/        #   Tailwind の入口:main.css(色の変数 ライト / ダーク。論点 0058)と popup.css(キャラの窓。論点 0079)
│   ├── eval/                       #   app: 計測(応援メッセージの品質・レイテンシ、画像のモデルと作り方)
│   └── installer/                  #   app: インストーラの同意の文書の組み立て(ビルドのときだけ使う。論点 0060)
├── installer/                      # インストーラ(NSIS)に足す手順 installer.nsh。license.txt はビルドのたびに作る(追跡外)
├── tests/                          # 単体 + 総合の両方を書く(Core)
│   ├── core/                       #   単体:docs の全シナリオ
│   ├── agent/ main/ preload/ renderer/ eval/ installer/  # 単体:app 側(実装ディレクトリと 1 対 1)
│   └── integration/                #   総合:繋いだ経路を最初から最後まで通す(発動の縦 1 本 / 設定更新)
└── scripts/
    ├── validate.sh                 # 機械検査(項目の正本は impl-rules.md N-8)。/validate が呼ぶ(Core)
    ├── hooks.sh                    # hooks の実体。format|test(Core)/ veto|validate(Scale)を引数で切替
    ├── postbuild.mjs               # このプロジェクト固有:dist を Electron が読める形に整える
    ├── fetch-image-eval.sh / image-eval.Dockerfile  # 画像の計測用:sd.cpp と重みの取得、計測用コンテナ(論点 0041 / 0045)
    ├── fetch-seg-eval.sh           # 切り抜きの計測用:u2netp と onnxruntime-node をリポジトリの外に取得(論点 0063)
    ├── fetch-sdcpp.sh              # 同梱する sd.cpp(Windows 向け CPU 版)を vendor/sdcpp/ に取得する(論点 0040)
    ├── fetch-u2netp.sh             # 同梱する u2netp(人物の切り抜き)を sha256 で照合して vendor/u2netp/ に取得する(論点 0063 / 0066)
    ├── fetch-ollama.sh / fetch-voicevox.sh  # 同梱する Ollama・VOICEVOX ENGINE(Windows 向け CPU 版。ENGINE は音声モデル 2 つだけ)を vendor/ に取得(論点 0034 / 0044)
    ├── extract-text-model.sh       # 配布するテキストモデルの GGUF を開発機の Ollama から取り出して release/weights/ に置く(論点 0074)
    ├── fetch-image-weights.sh      # 配布する画像の重み 2 つを release/weights/ に取得する(論点 0041 / 0055)
    ├── build-installer-license.mjs # インストーラの同意の文書 installer/license.txt を作る(論点 0043 / 0047 / 0060)
    └── build-installer.sh          # ビルド専用コンテナ(electron-builder の wine つき)で NSIS のインストーラを作る(論点 0031)
```

## 依存方向

```
src/core          ←          src/{agent,main,preload,renderer,eval}
(決定的・安定。純関数中心)      (それを使う側)
```

- **矢印の向きにしか依存してよい。** core は app を import しない。
  app 内では `main → agent` の一方向だけを許す。逆向きを作ると、テスト容易性と再現性が同時に壊れる。
  これは `eslint.config.js` の no-restricted-imports が機械的に止める。
- 各ディレクトリに何が入るかは上のツリー(ここに再掲しない)。

## このプロジェクトの不変条件

- **プライバシー**:キーの種類のみ数える。入力内容・キーシーケンスは記録も送信もしない。
  キーカウント・KPM・応援発動経路は**永久に外部送信しない**。
  キャラ作成の生成もローカルだけで、外部送信しない(論点 0054)。
- **応援発動経路はプロバイダーに依存しない**。発動はプール + wav のみで成立する。
- **KPM 算出窓は 60 秒固定**(設定で変えない)。
- **再現性**:乱数シード(画像生成 seed・メッセージ選択)と依存バージョンを固定する。
- **フォールバック**:Ollama / VOICEVOX / sd.cpp が未起動でもクラッシュせず、baseline 定型文で応援する。

## 仕様の正本

| 置き場 | 中身 |
| --- | --- |
| `docs/` | 決定を統合した確定要件(何を満たすか)。ここが最終的な正 |
| `src/` `tests/` | **どう作ったか**。構造は読めば分かるので文書に写さない |
| `docs/glossary.md` | ドメイン用語の正本。**登録されていない語をコードで使わない** |
| `decisions/undecided/` | 議論中の論点(案・比較・現在の考え) |
| `decisions/decided/` | 決定済みの論点(決定・理由・却下した案・反映先) |
| `work/NNNN-*/` | 反映作業の単位(tasks / diff)。**git 追跡外** |

食い違いを見つけたら **ドキュメント → テスト → ソースコード** の順に上位を正とする。
実装が通らないからといって `docs/` やテストを書き換えない。

## 変更の進め方

決定的(同じ入力 → 同じ出力)か、非決定的(指標でしか測れない)かをまず判定する。

共通の流れは **論点 → 決定 → 統合 → 作業 → テスト・実装**。

1. `decisions/undecided/NNNN-<論点>/topic.md` に案を書いて議論する(種別タグを必ず書く)。
2. **人間が決定を承認**したら `decisions/decided/` へ移す。
3. **その場で統合** — 満たすべきことを `docs/` へ GIVEN/WHEN/THEN で書き起こす。未統合を残さない。
   シナリオ見出しは `### S<論点番号4桁>_<連番2桁> <名前>` で、**先頭4桁は論点番号**。
   **構造(層・ファイル分割・関数名)は文書に書かない。**
4. `work/NNNN-<作業>/` を切り、失敗するテストを先に書く(Red)→ 最小実装(Green)→
   リファクタ → 総合テスト。**作業中に `docs/` を書き換えない。**
   テスト名にはシナリオ ID を**一字も改変せず**含める(`it("S0012_01 ...")`)。
   `scripts/validate.sh` が要件 ↔ テストを ID で双方向照合する。

現在地を見失ったら `/where`(読み取り専用)。効いている関門・途中の作業・以降の宿題を集めて
次の一手を1つ示す。**整合の判定はしない** — NG を出す検査は `/validate` が正本。

決め方だけが2通りに分かれる。

- **決定的** … 案を並べて比較し、根拠で決める。
- **非決定的** … 論点フォルダに `config.yaml` / `result.md` を同居させ、**計測で決める**。
  1論点 = 1変数のみ変更。baseline(`src/core/baseline/messages.ts`)と比べ、
  シードと依存を固定した結果だけを残す。

## 開発の規律はどこにあるか

このリポジトリは**仕様ループ + 探索ループのプロジェクトフォーマット**の上で開発している。
規律の本体は `CLAUDE.md` と `.claude/`(rules / skills / settings)にあり、**git 追跡外**
(個人開発を前提にしているため)。**どのパスが何を持つかは上の「ディレクトリ構造」が正本**で、
ここに再掲しない。どのルールを見るかの索引は `CLAUDE.md` の「参照先」表。

- clone しただけではこれらは手に入らない。**チームで共有するなら `.gitignore` の該当行を消す**
  (下の「規模に応じた拡張」)。
- ルールの内容をこのファイルに書き写さない。写すと片方が古いまま残る。
- **例外:** このファイルの「依存方向」「変更の進め方」は、規律を持たない読み手にも通じるように
  **意図して写している**。**ルール側(`impl-rules.md`「不変条件」/ `doc-rules.md`「確定の流れ」)を
  変えたら、ここも必ず直す。** 写しであることを忘れると古い図が残る。

## 規模に応じた拡張

- **個人**: Core のみ(現在ここ)。
- **チーム**: + Scale(`settings.team.json` を `settings.json` にマージ・CI から validate)。
  `decisions/` は既定で追跡されるので、議論と決定はそのまま共有される。
- **Adapt(このプロジェクト固有)**: `eslint.config.js` の no-restricted-imports が
  core の依存方向と応援発動経路の分離を機械的に止めている。

各レイヤーの中身・未収録のもの・設計思想は `.claude/rules/architecture.md`。

## このプロジェクト固有の注意

- **生成ランタイムは現状「各自で用意」**。キャラ作成には Ollama(:11434)と
  VOICEVOX ENGINE(:50021)が要る。論点 0010 でランタイム同梱、論点 0055 でモデル重みの同梱を決めたが、
  その仕組みは未実装。エンドポイントは `system` 設定で上書きできる。
  未起動でもアプリはクラッシュせず、baseline 定型文で応援する。
- **バンドラを使わない**。`tsc` の出力を `scripts/postbuild.mjs` が Electron 向けに整える
  (renderer の HTML コピー、preload を `.mjs` へ、React の UMD を `dist/renderer/vendor` へ)。
  出力パスを変えたら postbuild と `package.json` の `main` を同時に直す。
- **メインウィンドウの見た目は Tailwind**(論点 0058)。`npm run build:css` が `src/renderer/styles/main.css` から
  `dist/renderer/main.css` を作る(`tailwind.config.js` が `mainEntry.ts` のクラス名を拾う)。色は `main.css` の変数だけで決め、
  ダーク(論点 0057)は `<html class="dark">` で変数を差し替える。画面側に色を直書きしない。キャラの窓(`popup.html`)は使わない。
- **sd.cpp の画像生成は重い**。時間予算(budget/timeout)を引数で受け、超過前にフォールバックする。
- キー監視(uiohook-napi)はネイティブ依存。Windows 実機での確認が要る場面がある。
