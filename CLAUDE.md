# KeyCheer

キー押下数・打鍵速度に応じて、ユーザーが設定したキャラクターが音声とポップアップで応援してくれる Windows デスクトップアプリ。応援メッセージと音声は**キャラ作成時に一括生成**(プールと wav を事前用意)しておき、**応援発動はアプリ単体で完結**する。キャラ作成時の生成手段はローカル(Ollama / VOICEVOX / sd.cpp)または外部 API(OpenAI / Anthropic / ElevenLabs / DALL-E 等)を**プロバイダー**として差し替え可能。デフォルトはローカル一式で完全オフライン動作。

## 開発原則(最重要)

新しい作業を始めたら、**まず「決定的か?」を判定して報告する**こと。判定を飛ばして実装に入らない。2つのループを混ぜない。

- **決定的**(同じ入力 → 同じ出力)= **仕様ループ**:仕様 → テスト → 実装 → テスト
  例:キーカウント、アクティブ時間判定(設定値、既定60秒)、KPM算出(60秒固定窓)、速度ゾーン分類、応援トリガー(`regular` 既定 50、設定可能)、データ契約。
  詳細は @.claude/rules/spec-rules.md / @.claude/rules/test-rules.md / @.claude/rules/impl-rules.md に従う。
- **非決定的**(指標で測るしかない)= **探索ループ**:仮説 → 設定 → 計測 → 考察
  例:Ollama 応援メッセージの「らしさ・面白さ」、生成レイテンシ、sd.cpp キャラ画像の品質。
  詳細は @.claude/rules/experiment-rules.md に従う。

判定の指針:出力が一意に決まり受け入れ条件を書けるなら決定的(例:240 KPM → `fast` ゾーン)。文言の良し悪し・速度・品質など指標でしか測れないなら非決定的。

## このプロジェクトの「正」(source of truth)

- 決定的な振る舞いの正は `specs/`(承認・実装済みの確定仕様)。進行中は `changes/NNNN-*/spec.md`。
- プライバシー方針(絶対の制約):
  - キーフックは**キーの種類のみカウント**。入力内容・キーシーケンスは記録・送信しない。
  - キーカウント・KPM・統計・**応援発動経路**は**永久に外部送信しない**(localhost 含む一切のサーバー通信なし)。
  - キャラ作成時に限り、ユーザーが UI で外部プロバイダーを**明示選択**し、送信内容を提示する**同意ダイアログを通過**した場合のみ、当該プロバイダーへ性格説明・プロンプトを送信する。
  - API キーは OS セキュアストレージ(Electron `safeStorage`)に保存。平文 JSON に出さない。
- 動作前提:Ollama/VOICEVOX/sd.cpp が未起動でも**クラッシュせず**フォールバック(キャラ作成は完了させない/baseline 定型文で応援)する。応援発動はプール + wav が揃っていれば外部依存ゼロで動く。

自己解釈でここに無い挙動を足さない。曖昧な点は [要確認] として人間に確認する。

## Stack

- 言語/FW: TypeScript 5.x / Electron(メイン+レンダラ)、UI は React + Tailwind CSS。バージョンは lockfile で固定。
- 生成プロバイダー抽象: テキスト/音声/画像を差し替え可能(キャラ作成時のみ呼び出し)。
  - テキスト: `local-ollama`(HTTP :11434、推奨 gemma2:2b)/ `openai` / `anthropic`
  - 音声: `local-voicevox`(HTTP :50021)/ `openai-tts` / `elevenlabs`
  - 画像: `local-sdcpp`(CLI 子プロセス、SD1.5 アニメ系 + LCM LoRA)/ `openai-dalle` / `stability-ai`
- シークレット: Electron `safeStorage`(Windows Credential Manager)。
- キー監視: uiohook-napi。保存: electron-store。ビルド: electron-builder。
- 環境: Windows(開発は WSL2 可)。iGPU/CPU でも動く構成。

## Commands

スキャフォルディング完了。実装は TDD(`/run-loop`)で進める。

- 依存導入: `npm install`(初回 / 依存変更時。lockfile は `package-lock.json` で固定)
- テスト: `npm test`(Vitest、`tests/**/*.test.ts`)
- テスト(watch): `npm run test:watch`
- 型チェック: `npm run typecheck`(`tsc --noEmit`)
- Lint: `npm run lint`(ESLint flat config、engine の boundary 違反検出含む)
- フォーマット: `npm run format`(Prettier)
- 検証: `npm run validate` または `bash scripts/validate.sh`(spec ↔ test の整合)
- 評価/計測(探索ループのみ): `npm run eval`(応援メッセージ品質・レイテンシ)

## 不変条件

- 再現性を保つ:乱数シード(画像生成 seed、メッセージ選択)・依存バージョンを固定する。再現できない結果は残さない。
- 依存方向は一方向:安定・決定的なコア(`src/engine`:カウント/KPM/ゾーン/トリガー/プール選択)は、非決定的な側(`src/agent`:プロバイダー実装、UI/IPC)に依存しない。逆向きのみ許す。
- engine は **設定値を引数で受け取る純粋関数**。グローバル状態・electron-store 直接参照を持たない。設定変更の即時反映は main 側のディスパッチで実現する。
- プライバシー方針(入力内容を記録・送信しない / 応援発動経路は外部依存ゼロ / 外部送信はキャラ作成時の明示同意のみ / API キーは平文 JSON に出さない)を破る変更を入れない。
- 応援発動経路から **`providers` 設定を参照しない**(コード上 import レベルで分離)。
- **KPM 算出窓 = 60 秒固定**。`triggers.activeThresholdSec`(設定可能、既定 60)とは独立(KPM は「分」表記の意味を保つ)。
- **連続回避はセッション内除外方式**(LRU ではない、永続化しない)。
- **監査ログは `{userData}/audit.log.json` 別ファイル**(`stats` と混ぜない)。プライバシー境界をデータレベルで明示する。
- **Baseline 定型文は `src/engine/baseline/messages.ts` にコード同梱**(リソース化しない)。
- キーリピート(押しっぱなし)は Phase 1 では**生イベントごとに 1 カウント**(デバウンスしない)。

## Don't(罠 — やりたくなるが禁止)

- spec を人間が承認する前に実装を書き始めない。
- 応援メッセージや画像の「良さ・面白さ」をテストで判定しようとしない(それは探索ループの result で測る)。
- 赤を確認しないまま実装しない。緑のままのテストを「検証済み」と扱わない。
- シード・依存バージョンを固定せずに result.md に数値(品質スコア・レイテンシ等)を書かない。
- engine(決定的コア)から各プロバイダー実装(Ollama/VOICEVOX/sd.cpp/外部 API)や Electron API を import しない。
- **応援発動経路から `providers` 設定・プロバイダー実装を import しない**(発動はプール + wav のみで成立)。
- ルールの本文を CLAUDE.md に直書きで増やさない。詳細は .claude/rules/ に置きここからは参照する。

---

## 設計レイヤー(拡張の地図)

このプロジェクトは3レイヤー × 3手段で構成される。詳細は @.claude/rules/architecture.md。

- **Core**(常時): 二系統原則 / 基本 skill / format+test フック
- **Scale**(規模で足す): ADR / 危険操作veto / CI / sub-agent
- **Adapt**(種別で差替): 「正」の定義(要件+プライバシー方針) / ドメイン別 skill / baselines 等

担保手段は3つ。**方針**=この CLAUDE.md と .claude/rules/(守ってほしい) / **実行**=.claude/skills/(コマンド化) / **強制**=.claude/settings.json の hooks(守らせる)。
