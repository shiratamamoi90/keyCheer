# KeyCheer ⌨️🎉(仕様ループ + 探索ループ / Claude Code 前提)

キー押下数・打鍵速度に応じて、自分で設定したキャラクターが音声とポップアップで応援してくれる Windows デスクトップアプリ。すべてオフラインで完結する。

決定的な部分(カウント/KPM/速度ゾーン/トリガー)は **仕様ループ**(仕様→テスト→実装→テスト)、
非決定的な部分(応援メッセージ生成/画像生成の品質)は **探索ループ**(仮説→設定→計測→考察)で開発する。
規律は **方針(CLAUDE.md)/ 実行(skill)/ 強制(hooks)** の3手段で担保する。

## 特徴

- 🎯 設定した回数キーを押す・打鍵速度に応じて応援
- 🗣️ ローカルAI(Ollama)が応援メッセージを動的生成
- 🔊 ローカルTTS(VOICEVOX)でキャラの声で読み上げ
- 🎨 キャラの名前・性格・口調・画像をカスタマイズ(画像は stable-diffusion.cpp で AI 生成も可)
- 🔌 完全オフライン。ネット通信は localhost のみ。入力内容は記録・送信しない

## ステータス

設計フェーズ。`specs/` に決定的な確定仕様、`decisions/` に設計判断(ADR)、`experiments/` に AI 部の探索計画を置いている。これから Phase 1(MVP)の実装に着手する。

## 使い方(開発の最小5ステップ)

1. `CLAUDE.md` の Stack / Commands / 「正」を実装状況に合わせて更新する。
2. `.claude/rules/` の各ルールを必要に応じて調整(基本そのままで可)。
3. `specs/` の確定仕様と `decisions/` の ADR を読み、次に着手する機能を決める。
4. Claude Code を起動。`/new-change <名前>` で変更を作り、spec を書いて承認する。
5. `/run-loop <change名>` で Red→Green→Refactor を回す。完了したら `/validate`。

## ディレクトリ構造

```
.
├── CLAUDE.md                       # 方針の入口(薄く保つ / Core)
├── README.md
├── .gitignore
├── .claude/
│   ├── settings.json               # hooks: format on edit, test on stop(Core)
│   ├── settings.team.json          # チーム用 hooks: veto, validate(Scale)
│   ├── rules/                      # ルールの正本(skill が参照 / Core)
│   │   ├── architecture.md         #   設計思想:分離軸 × 実装手段
│   │   ├── spec-rules.md           #   仕様設計のルール
│   │   ├── impl-rules.md           #   実装のルール(TS/Electron/インフラ)
│   │   ├── test-rules.md           #   テストのルール(テスト先行)
│   │   └── experiment-rules.md     #   探索のルール(AI 部)
│   └── skills/                     # スラッシュコマンド(実行 / Core)
│       ├── new-change/SKILL.md     #   /new-change   仕様ループ起点
│       ├── new-experiment/SKILL.md #   /new-experiment 探索ループ起点
│       ├── run-loop/SKILL.md       #   /run-loop     Red→Green→Refactor
│       └── validate/SKILL.md       #   /validate     spec↔test 整合検査
├── specs/                          # 決定的部分の source of truth(Core)
│   ├── README.md                   #   確定仕様の置き場ルール
│   ├── key-counter.md              #   キーカウント・アクティブ時間(60秒)
│   ├── speed-zone.md               #   KPM 算出・速度ゾーン分類
│   ├── cheer-trigger.md            #   通常/マイルストーン発動・ゾーン別キャッシュ
│   ├── data-model.md               #   設定/統計/ランタイムのデータ契約
│   └── integrations.md             #   Ollama/VOICEVOX/sd.cpp 連携の決定的契約
├── changes/                        # 仕様ループの作業単位(Core)
│   └── 0001-speed-zone/            #   着手例:KPM→速度ゾーン分類
│       ├── proposal.md             #     なぜ変えるか・影響範囲
│       ├── spec.md                 #     GIVEN/WHEN/THEN
│       ├── tasks.md                #     テスト先行チェックリスト
│       └── diff.md                 #     ADDED/MODIFIED・完了条件
├── experiments/                    # 探索ループの作業単位(Core)
│   └── 0001-cheer-prompt-tone/     #   例:応援プロンプトのトーン調整
│       ├── hypothesis.md           #     仮説・測り方・中止条件
│       ├── config.yaml             #     変更パラメータ(1実験1変数)
│       └── result.md               #     指標の実測値・考察
├── src/                            # 依存方向 engine←agent←eval(Core/Adapt)
│   ├── engine/                     #   決定的・安定:カウント/KPM/ゾーン/トリガー
│   ├── agent/                      #   非決定的:Ollama 応援生成 / sd.cpp 画像生成
│   └── eval/                       #   メッセージ品質・レイテンシ計測
├── tests/                          # engine は全シナリオ、agent はスモークのみ(Core)
│   ├── engine/
│   └── agent/
├── decisions/                      # ADR:設計判断の記録(Scale)
│   ├── 0001-desktop-framework-electron.md
│   ├── 0002-local-llm-ollama.md
│   ├── 0003-tts-voicevox.md
│   ├── 0004-image-gen-forge-superseded.md
│   ├── 0005-image-gen-sdcpp-lcm.md
│   └── 0006-speed-zone-cheer.md
├── scripts/
│   └── validate.sh                 # 自前 validate(Scale)
└── baselines/                      # 探索の比較基準(Adapt / AI系)
    └── README.md                   #   定型文ジェネレータ = baseline
```

## ディレクトリ一覧

| パス                       | 役割                                            | レイヤー    |
| -------------------------- | ----------------------------------------------- | ----------- |
| CLAUDE.md                  | 方針の入口(薄く保つ)                            | Core        |
| .claude/rules/             | ルールの正本(skill が参照)                      | Core        |
| .claude/skills/            | /new-change /new-experiment /validate /run-loop | Core        |
| .claude/settings.json      | hooks(format on edit, test on stop)             | Core        |
| specs/                     | 決定的部分の source of truth                    | Core        |
| changes/NNNN-\*/           | 仕様ループの作業単位                            | Core        |
| experiments/NNNN-\*/       | 探索ループの作業単位(AI 部)                     | Core        |
| src/{engine,agent,eval}    | 依存方向 engine←agent←eval                      | Core/Adapt  |
| tests/                     | engine は全シナリオ、agent はスモークのみ       | Core        |
| decisions/                 | ADR(設計判断の記録)                             | Scale       |
| scripts/validate.sh        | 自前 validate                                   | Scale       |
| .claude/settings.team.json | チーム用 hooks(マージで有効化)                  | Scale       |
| baselines/                 | 探索の比較基準(定型文ジェネレータ)              | Adapt(AI系) |

## 種別としての位置づけ(Adapt)

KeyCheer は **Web/業務アプリ寄り(仕様ループが主役)+ AI機能(探索ループを一部併用)** のハイブリッド。

- 決定的コア(カウント/KPM/ゾーン/トリガー/データ契約)→ 仕様ループで縛る(主役)。
- AI 機能(応援文言・画像品質・レイテンシ)→ 探索ループで指標計測。テストでは「クラッシュしない/予算内/フォールバックする」という決定的部分のみ縛る。

詳細な設計思想は `.claude/rules/architecture.md` を参照。
