# 開発ガイド:KeyCheer

このリポジトリで**開発・改修する人**のための文書。ソフトの導入と使い方は [README.md](README.md)。

## 開発環境のセットアップ

README.md の「動作環境」に**加えて**必要なもの。

```bash
npm install       # 依存導入(バージョンは package-lock.json で固定)
npm run build     # tsc -p tsconfig.build.json → scripts/postbuild.mjs
npm run dev       # build 後に electron dist/main/index.js を起動
```

- 依存はバージョンを固定する(`package-lock.json`)。固定しないと再現できない。
- `.env` はコミットしない。**API キーは `.env` に置かず** Electron `safeStorage`
  (Windows Credential Manager)へ保存する。必要な環境変数:無し。
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

## テスト

```bash
npm test                                   # 全テスト。変更を閉じる前に必ず通す
npx vitest run tests/core tests/agent tests/main tests/preload tests/renderer  # 単体だけ
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
├── .claude/
│   ├── settings.json               # hooks の配線: format on edit, test on stop(Core)
│   ├── settings.team.json          # チーム用 hooks の配線: veto, validate(Scale, マージで有効化)
│   ├── rules/                      # ルールの正本8本(どれを見るかは CLAUDE.md の参照先表 / Core)
│   └── skills/                     # new-topic / decide / new-work / run-loop / validate(実行 / Core)
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
│   ├── agent/                      #   app: 生成 I/O(プロバイダー実装・プール生成・監査ログ)
│   ├── main/                       #   app: Electron メイン(キーフック・IPC・store・窓・トレイ)
│   ├── preload/  renderer/         #   app: レンダラに公開する最小 API と UI
│   └── eval/                       #   app: 応援メッセージの品質・レイテンシ計測
├── tests/                          # 単体 + 総合の両方を書く(Core)
│   ├── core/                       #   単体:docs の全シナリオ
│   ├── agent/ main/ preload/ renderer/  # 単体:app 側(実装ディレクトリと 1 対 1)
│   └── integration/                #   総合:繋いだ経路を最初から最後まで通す(発動の縦 1 本 / 設定更新)
└── scripts/
    ├── validate.sh                 # 機械検査(項目の正本は impl-rules.md N-8)。/validate が呼ぶ(Core)
    ├── hooks.sh                    # hooks の実体。format|test(Core)/ veto|validate(Scale)を引数で切替
    └── postbuild.mjs               # このプロジェクト固有:dist を Electron が読める形に整える
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
  キーカウント・KPM・統計・応援発動経路は**永久に外部送信しない**。
  外部送信はキャラ作成時に、利用者が外部プロバイダーを明示選択し同意した場合のみ。
- **応援発動経路はプロバイダーに依存しない**。発動はプール + wav のみで成立する。
- **KPM 算出窓は 60 秒固定**(`triggers.activeThresholdSec` とは独立)。
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
  VOICEVOX ENGINE(:50021)が要る。論点 0010 でランタイム同梱・モデル重みの初回取得と決めたが、
  その仕組みは未実装。エンドポイントは `system` 設定で上書きできる。
  未起動でもアプリはクラッシュせず、baseline 定型文で応援する。
- **バンドラを使わない**。`tsc` の出力を `scripts/postbuild.mjs` が Electron 向けに整える
  (renderer の HTML コピー、preload を `.mjs` へ、React の UMD を `dist/renderer/vendor` へ)。
  出力パスを変えたら postbuild と `package.json` の `main` を同時に直す。
- **sd.cpp の画像生成は重い**。時間予算(budget/timeout)を引数で受け、超過前にフォールバックする。
- キー監視(uiohook-napi)はネイティブ依存。Windows 実機での確認が要る場面がある。
