# diff: change 0002 を specs/ と CLAUDE.md に反映

## 反映先

### specs/integrations.md(全面書き直し)

- 「Ollama を応援発動のたびに呼ぶ」前提を撤回。Ollama / VOICEVOX / sd.cpp は**キャラ作成時のみ**使用に統一。
- システムプロンプトを「1 文返す」から「シナリオ {zone, type, timeOfDay} で 20 文返す」に変更(計 480 文)。
- 「プール一括生成」「全文事前合成」「生成途中の中断 → 再開」シナリオを追加。
- 「VOICEVOX 未起動時のフォールバック」を「応援時にテキストのみ」から「キャラ作成フローでエラー表示」に変更。
- 「プリキャッシュは速度ゾーン別バケット」シナリオは削除(プールに統合)。

### specs/cheer-trigger.md(全面書き直し)

- タイトルを「ゾーン別キャッシュ選択」→「メッセージプール選択」に変更。
- 「ゾーン別バケットからの取り出し」を「`(zone, type, timeOfDay)` シナリオキーからの 1 文選択 + 対応 wav 再生」に置き換え。
- 新規シナリオ:
  - 発動時に `(zone, timeOfDay)` を付与する
  - **発動経路で外部依存に触らない[不変条件]**
  - 同一文の連続再生を避ける[要確認]
  - バケット欠損時の段階的フォールバック(同 `(type, timeOfDay)` → 同 `type` → baseline 定型文)
  - 音声ファイル欠損時のテキストフォールバック
  - キャラ未作成時の発動(baseline 定型文)
- 履歴フィールドに `timeOfDay` / `messageId` を追加。

### specs/data-model.md(追加 + シナリオ追加)

- `character` に `generatedBy: { text, voice, image }` を追加。
- 新セクション「メッセージプール(`{userData}/characters/{characterId}/pool.json`)」追加。24 シナリオ × 約 20 文の構造、`completion` フラグを定義。
- 新セクション「音声ファイル(`{userData}/characters/{characterId}/voices/{messageId}.wav`)」追加。
- `cheerHistory` エントリに `timeOfDay` / `messageId` を追加。
- `runtime` に `lastMessageIdByBucket`(連続回避用)を追加。
- 新規シナリオ「timeOfDay は 4 値のみ[境界]」を追加。
- 検討事項に「プール version 互換」「baseline 定型文の同梱位置」を追加。

### CLAUDE.md

- 冒頭の説明を「Ollama が生成し VOICEVOX が読み上げる」→「キャラ作成時に一括生成、応援発動はアプリ単体で完結」に書き換え。
- 動作前提を「Ollama/VOICEVOX 未起動時の応援フォールバック」→「プール + wav が揃っていれば外部依存ゼロ」に変更。
- 「Don't」に「応援発動経路から各プロバイダー実装を import しない」を追加。

## アーカイブ

本 change は specs/ に反映済み。0003 の依存元として参照は残るが、進行中タスクとしてはクローズ。
