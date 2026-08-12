# 要件: timeOfDay 分類関数

現在時刻(時のみ)から `TimeOfDay ∈ {"morning", "afternoon", "evening", "night"}` を決定的に返す純粋関数を提供する。
境界は本 spec で固定し、呼び出し元(main / renderer)はこの関数だけを使う(各自で `if (h < x)` を書かない)。

## 境界定数(確定)

| 定数              | 値 | 意味                                                              |
| ----------------- | -: | ----------------------------------------------------------------- |
| `MORNING_START`   |  5 | 朝の開始(含む)                                                  |
| `AFTERNOON_START` | 11 | 昼の開始(含む)                                                  |
| `EVENING_START`   | 17 | 夕方の開始(含む)                                                |
| `NIGHT_START`     | 21 | 夜の開始(含む)。次の `MORNING_START` で終わる(0–4 時も night) |

区間は **半開区間 `[start, end)`**(start を含み、end を含まない)。

| 範囲                | timeOfDay   |
| ------------------- | ----------- |
| `[5, 11)`           | `morning`   |
| `[11, 17)`          | `afternoon` |
| `[17, 21)`          | `evening`   |
| `[21, 24) ∪ [0, 5)` | `night`     |

## 引数契約(確定)

- `classifyTimeOfDay(hour: number)` — `hour` は **0 以上 23 以下の整数**(`Date.prototype.getHours()` の戻り値域と同じ)。
- engine 内では検証も正規化も throw もしない。**呼び出し側が `0..23` 整数を渡す責務**を負う(設計時点で防ぐ)。
- ローカル時刻 / UTC の判断は engine の責務外。呼び出し側で `date.getHours()`(ローカル時)を採用する。

### S0014_01 朝の代表時刻

- GIVEN `hour = 7`
- WHEN `classifyTimeOfDay(7)` を呼ぶ
- THEN `"morning"` を返す

### S0014_02 昼の代表時刻

- GIVEN `hour = 13`
- WHEN `classifyTimeOfDay(13)` を呼ぶ
- THEN `"afternoon"` を返す

### S0014_03 夕方の代表時刻

- GIVEN `hour = 18`
- WHEN `classifyTimeOfDay(18)` を呼ぶ
- THEN `"evening"` を返す

### S0014_04 夜の代表時刻

- GIVEN `hour = 23`
- WHEN `classifyTimeOfDay(23)` を呼ぶ
- THEN `"night"` を返す

### S0014_05 深夜は night [境界]

- GIVEN `hour = 0` と `hour = 4`(24 時跨ぎの night 範囲内)
- WHEN それぞれ呼ぶ
- THEN いずれも `"night"` を返す

### S0014_06 night → morning 境界 [境界]

- GIVEN `MORNING_START = 5`(半開区間)
- WHEN `hour = 4` → `hour = 5`
- THEN `"night"` → `"morning"`

### S0014_07 morning → afternoon 境界 [境界]

- GIVEN `AFTERNOON_START = 11`(半開区間)
- WHEN `hour = 10` → `hour = 11`
- THEN `"morning"` → `"afternoon"`

### S0014_08 afternoon → evening 境界 [境界]

- GIVEN `EVENING_START = 17`(半開区間)
- WHEN `hour = 16` → `hour = 17`
- THEN `"afternoon"` → `"evening"`

### S0014_09 evening → night 境界 [境界]

- GIVEN `NIGHT_START = 21`(半開区間)
- WHEN `hour = 20` → `hour = 21`
- THEN `"evening"` → `"night"`

### S0014_10 Date からの薄いラッパ

- GIVEN `date = new Date(2026, 5, 21, 18, 30, 0)`(ローカル時刻 18:30)
- WHEN `classifyTimeOfDayFromDate(date)` を呼ぶ
- THEN `classifyTimeOfDay(date.getHours())` と同値の `"evening"` を返す

### S0014_11 決定性 [不変条件]

- GIVEN 同じ `hour` 値
- WHEN `classifyTimeOfDay(hour)` を複数回呼ぶ
- THEN 常に同じ結果を返す(乱数・I/O・外部依存に触らない)

## 不変条件

- 純粋関数(副作用なし、入力以外を参照しない)。
- engine 層に置く。Electron API / fetch / child_process を import しない。
- 境界定数(`MORNING_START` / `AFTERNOON_START` / `EVENING_START` / `NIGHT_START`)は export し、呼び出し側からも参照可能にする(マジックナンバー禁止)。
- 引数 `hour` の有効域(`0..23` 整数)は **呼び出し側で保証**する(本関数内では検査しない)。`Date.getHours()` の戻り値はこの域を満たすため、ラッパ経由なら自然に成立する。
