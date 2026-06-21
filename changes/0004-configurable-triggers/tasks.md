- [ ] spec の各シナリオに対応する失敗テストを書く(Red)
  - tests/engine/triggerConfig.test.ts(既定値・バリデーション・即時反映)
  - tests/engine/trigger.test.ts(設定値を引数で受ける版)
  - tests/engine/keyCounter.test.ts(`isActive` が `activeThresholdSec` を引数で受ける版)
- [ ] テストが赤になることを確認
- [ ] engine 側の最小実装(Green):
  - [ ] `src/engine/triggerConfig.ts` — `TriggerConfig` 型、既定値定数、`validateTriggerConfig()`、`mergeWithDefaults()`(旧 JSON 補完)
  - [ ] `src/engine/trigger.ts` — `triggers.regular` をハードコードせず引数で受ける
  - [ ] `src/engine/keyCounter.ts` — `isActive(last, now, thresholdSec)` 形に修正
- [ ] main 側:
  - [ ] 起動時バリデーション → 不正キーは既定値に置換しログ
  - [ ] 設定保存時に engine 側へ通知 → 次のキーから新値で判定
- [ ] UI(設定画面・トリガータブ):
  - [ ] 通常応援間隔の数値入力(min/max クランプ、リアルタイムバリデーション表示)
  - [ ] マイルストーン編集(追加/削除/編集、自動ソート・重複検出)
  - [ ] アクティブ秒数の数値入力
  - [ ] 保存ボタン + バリデーションエラー表示
- [ ] リファクタ(全緑維持)
- [ ] specs/cheer-trigger.md・specs/key-counter.md・specs/data-model.md に反映、diff.md 作成、change をアーカイブ

> 注意:
>
> - 確定事項(承認済み): KPM 窓は activeThresholdSec とは独立で 60 秒固定 / 既存 `triggers.regular=100` はアップデート時に 50 にリセット + 通知 / 値域は通常 1-10000・アクティブ 5-600・マイルストーン最大 20 / マイルストーン空配列許容
> - 速度ゾーン閾値の設定可能化は **本 change のスコープ外**(必要なら別 change を切る)。
> - マイグレーション通知は engine ではなく main 側で表示(engine は決定的なので副作用を持たない)。
