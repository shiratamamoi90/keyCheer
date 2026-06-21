# 実装のルール(技術・インフラ)

## 技術選定

- 言語/FW: TypeScript 5.x / Electron。UI は React + Tailwind CSS。バージョンは lockfile で固定。
- コアロジック(`src/engine`)は副作用を閉じ込めた純粋関数中心。状態は不変に近い形で受け渡す:
  `update(state, event) -> newState`(例:キーイベントでカウンタ/リングバッファを更新)。テストと UI 表示の両方で再利用するため。
- engine は Electron API・`fetch`・`child_process` を**直接触らない**。I/O は agent / 上位(main プロセス)が担う。

## Electron 構成と engine←agent←eval の対応

| 本テンプレの層             | KeyCheer 上の実体                                                        | 例                                            |
| -------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| `src/engine`(決定的・安定) | カウント / アクティブ時間 / KPM / 速度ゾーン / トリガー判定 / データ契約 | `keyCounter.ts`, `speedZone.ts`, `trigger.ts` |
| `src/agent`(非決定的)      | Ollama 応援生成、sd.cpp 画像生成、プリキャッシュ                         | `cheerGenerator.ts`, `imageGen.ts`            |
| `src/eval`(評価)           | メッセージ品質・レイテンシ計測スクリプト                                 | `evalMessages.ts`                             |

- メインプロセス(キーフック・IPC・トレイ・API 通信)と レンダラ(React UI)は engine を**利用する側**。engine 自体は両者に依存しない。
- VOICEVOX 連携・ポップアップ表示・トレイは I/O アダプタ(agent / main 側)に置く。

## 依存方向(不変条件)

- `src/engine`(決定的) ← `src/agent`(Ollama/sd.cpp) ← `src/eval`(評価)。
- engine は agent / eval / Electron / fetch を import しない。逆向きのみ許す。

## インフラ

- 開発: Windows ターゲット(WSL2 で開発可)。iGPU/CPU でも動く構成を維持。
- 乱数: シードを config で固定可能に(sd.cpp の `-s`、メッセージ選択の擬似乱数)。再現性のない結果は result に書かない。
- 依存は `package-lock.json` でバージョン固定。
- 時間予算が要る処理(応援は即応答が要る・sd.cpp は重い)は budget/timeout を引数で受け、超過前にフォールバック(定型文/手動アップロード誘導)する anytime 設計。
- 外部プロセス(sd.cpp 子プロセス)はタイムアウト・キャンセル・ゾンビ防止・重複起動排他を実装する。

## プライバシー(不変条件)

- キーフックは**キーの種類のみカウント**。入力文字・キーシーケンスを保存・送信しない。
- ネットワークは localhost(Ollama :11434 / VOICEVOX :50021)のみ。外部送信コードを入れない。

## コーディング規約

- engine の各ロジックに、対応する spec シナリオ名をコメントで付ける。
- フォーマッタ/リンタ(Prettier / ESLint)は hooks で自動実行(手動整形しない)。
