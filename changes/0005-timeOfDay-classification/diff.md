# 0005-timeOfDay-classification / 差分(実装済み)

## ADDED

- `src/engine/timeOfDay.ts`
  - 定数: `MORNING_START = 5`, `AFTERNOON_START = 11`, `EVENING_START = 17`, `NIGHT_START = 21`
  - 関数: `classifyTimeOfDay(hour: number): TimeOfDay`
  - 関数: `classifyTimeOfDayFromDate(date: Date): TimeOfDay`
- `tests/engine/timeOfDay.test.ts` — 19 テスト全緑
- `specs/time-of-day.md` — 確定仕様として追加

## MODIFIED

- `specs/data-model.md` — 「timeOfDay は 4 値のみ [境界]」に `specs/time-of-day.md` への参照を追記
- `specs/README.md` — ファイル一覧に `time-of-day.md` を追加
- `src/engine/index.ts` — `classifyTimeOfDay` / `classifyTimeOfDayFromDate` / 境界 4 定数を re-export

## 影響しない

- `cheerSelector` / `messagePool` のシグネチャは未変更
- 既存 83 テストは無変更で緑維持(全体 102/102 緑)

## 検証結果

- `npm test`: 7 ファイル / 102 テスト緑
- `npm run typecheck`: 0
- `npm run lint`: 0
- engine 境界(no-restricted-imports)違反なし

## 設計判断ログ

- 引数は **`hour: number`(0..23 整数)を主**、Date 用は薄いラッパ。
- engine 内では検査・正規化・throw を**しない**(呼び出し側が `Date.getHours()` 等で `0..23` 整数を保証)。
- 区間は **半開区間 `[start, end)`**。
- 24 時跨ぎの night(`[21, 24) ∪ [0, 5)`)は最終 fallthrough で実現(早期 return `hour < MORNING_START → night`)。

## アーカイブ

- 本 change は `changes/0005-timeOfDay-classification/` のまま保持(履歴として残す)。
- specs/ への反映済み。
