# 差分 0001: 打鍵速度ゾーン

## ADDED

- specs/speed-zone.md(KPM 算出・ゾーン分類の確定仕様)
- src/engine/speedZone.ts(`computeKpm`, `classifyZone`)
- tests/engine/speedZone.test.ts(6シナリオ)
- ランタイム状態に `currentKpm` / `currentZone`

## MODIFIED

- src/engine: トリガー判定が発動時に現在ゾーンを付与
- specs/cheer-trigger.md: ゾーン付与シナリオ
- specs/data-model.md: cheerHistory に `kpm` / `speedZone` を追加

## 完了条件

- [ ] 6シナリオに対応する失敗テスト → 赤確認 → 最小実装で全緑
- [ ] specs/ にマージしアーカイブ
- [ ] プライバシー不変条件を破っていない(押下時刻のみ保持、キー内容は保存しない)
