# diff: change 0004 を specs/ + CLAUDE.md + ADR に反映

承認済み確定事項(A2 のみ代替 = 50 にリセット、それ以外は推奨):

| 項目 | 確定                                                                  |
| ---- | --------------------------------------------------------------------- |
| A1   | KPM 窓は 60s 固定 / `activeThresholdSec` と独立                       |
| A2   | 既存 `triggers.regular=100` → **50 にリセット** + 起動通知            |
| A3   | 値域: regular 1-10000 / activeThresholdSec 5-600 / milestones 最大 20 |
| A4   | マイルストーン空配列許容(milestone OFF)                               |

加えて、0002・0003 由来の [要確認] 19 項目も一括確定(B1-B5・C1-C6・D1-D3 推奨採用)。

## 反映先

### specs/key-counter.md(全面書き直し)

- `isActive` 判定の閾値を **`triggers.activeThresholdSec`(設定値、既定 60)** に置換。
- 60 秒ちょうどは**非アクティブ**(strict less-than 方式)を明示(D1)。
- キーリピートは **生イベントごと 1 カウント**(デバウンスしない、Phase 1、D2)。
- 除外キー/アプリは **Phase 1 では未実装、スキーマのみ**(D3)。
- KPM 窓は `activeThresholdSec` と独立であることを不変条件として明示(A1)。

### specs/speed-zone.md(冒頭 + シナリオ追加)

- KPM 算出窓を「直近 1 分」→ 「直近 60 秒(コード固定、設定対象外)」に明確化(A1)。
- 「activeThresholdSec を変えても KPM 窓は不変」シナリオ追加(A1)。
- キーリピート扱いの [要確認] を確定済み参照に置換(D2)。

### specs/cheer-trigger.md(シナリオ更新 + 追加)

- 通常応援間隔の例値を 100 → 50 に更新(A2)。
- 連続回避を「セッション内除外方式」として確定(B1)。
- マイルストーン文の動的数値補間シナリオ(`{milestone}` プレースホルダ、テキストのみ補間、wav は数値抜き)を追加(B2)。
- マイルストーン空配列の境界シナリオ追加(A4)。
- 不変条件に「セッション内除外」「テキストのみ補間」を追加。

### specs/data-model.md(設定スキーマ + 多数のシナリオ追加)

- `triggers.regular` 既定: 100 → 50、値域注記追加(A2/A3-a)。
- `triggers.activeThresholdSec` キー追加(A1/A3-b)。
- `triggers.milestones` の値域注記追加(A3-c/A4)。
- `system.excludedKeys` キー追加(D3)。
- 新セクション「保存ルート」: `app.getPath('userData')` を明示(B4)。
- 新セクション「Baseline 定型文(同梱)」: `src/engine/baseline/messages.ts`(B5)。
- 新セクション「監査ログ(`{userData}/audit.log.json`)」(C5)。
- 新シナリオ「`triggers.regular = 100` のマイグレーション [境界]」(A2)。
- 新シナリオ「`triggers` 値域バリデーション [境界]」(A3)。
- `triggers.activeThresholdSec` 欠損時の既定値補完(後方互換)を「既定値補完」シナリオに追記。
- 「検討事項」を「β 以降に確定」と「確定済み」に分割。

### specs/integrations.md(MVP セット確定 + シナリオ追加/更新)

- 「MVP 実装セット(確定)」セクション追加: text/voice/image 各 ローカル+1 外部(C1)。
- 「同意はプロバイダー単位で 1 回のみ」シナリオに更新(C2)。
- 「同意ダイアログに ToS リンクと必須チェック」シナリオ追加(C4)。
- 「外部選択時の概算コスト表示」シナリオ追加(C3)。
- 「通信失敗・プロキシ環境」シナリオ追加(自動リトライしない、C6)。
- 「外部送信を監査ログに記録」シナリオ追加(C5)。
- 「生成途中の中断と再開」を確定文言に更新(B3)。
- 「一括生成中の進捗 UX」シナリオ追加(B3)。
- 不変条件に「自動リトライしない」を追加。

### CLAUDE.md

- 開発原則の例示にトリガー設定可能化を反映(`regular` 既定 50)。
- 不変条件に以下を追加:
  - engine は設定値を引数で受け取る純粋関数
  - KPM 窓 = 60s 固定、`activeThresholdSec` と独立
  - 連続回避はセッション内除外
  - 監査ログは `audit.log.json` 別ファイル
  - Baseline はコード同梱
  - キーリピートは生イベントごと 1 カウント

### decisions/0009-configurable-triggers.md(新規)

- 文脈・決定・トレードオフ・既存 ADR への影響を ADR として記録。
- ADR 0006 / 0007 / 0008 は撤回せず、影響なしとして明示。

## アーカイブ

本 change は specs/ + CLAUDE.md + ADR に反映済み。実装着手前のスキャフォルディング(`package.json` / Vitest / ESLint 等)が次の課題。

## 残る [要確認](β 以降)

- 値域上限の妥当性(β 実測で再評価)
- マイグレーション通知の文言
- 速度ゾーン閾値の β 実測確定(別軸)
- 統計の保持期間 / プール version 互換 / 同意有効期限 / 同梱モデル最終選定 / 概算コスト単価テーブル更新運用
