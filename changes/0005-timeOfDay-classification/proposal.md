# 提案: timeOfDay 分類関数の導入

## なぜ変えるか

`specs/cheer-trigger.md` / `specs/data-model.md` は応援発動時に `(zone, type, timeOfDay)` でバケットを選ぶことを契約している。
`timeOfDay ∈ {"morning", "afternoon", "evening", "night"}` の **定義域**は確定済みだが、
**「現在時刻 → どの値か」** を決める関数の境界(何時から何時までか)は spec に明記がない。
このまま `Date.now()` を引数に取る `cheerSelector` の呼び出し元(main プロセス)で各自実装させると、
分類が不一致になり「決定的コア」原則(同入力 → 同出力)が崩れる。

engine 内に **純粋な分類関数** を一つ置き、境界を spec で固定する。

## 影響範囲

### ADDED

- `src/engine/timeOfDay.ts`(新規)
  - `classifyTimeOfDay(hour: number): TimeOfDay`
  - `classifyTimeOfDayFromDate(date: Date): TimeOfDay`(`date.getHours()` を使う薄いラッパ)
- `tests/engine/timeOfDay.test.ts`(新規、Red-first)
- `specs/time-of-day.md`(新規、本 change の確定後)

### MODIFIED

- `specs/data-model.md` — 「timeOfDay は 4 値のみ [境界]」シナリオに「分類の境界は specs/time-of-day.md」参照を追記
- `src/engine/index.ts` — 公開エクスポートに追加
- `MEMORY.md` の不変条件参照(必要なら)

### 影響しない(明示)

- `cheerSelector` / `messagePool` のシグネチャは変えない。呼び出し側で `classifyTimeOfDay(new Date().getHours())` を渡す形に統一するだけ。
- 既存のテスト(83 件)は変更不要。

## 決定的か?

**決定的**。`hour: number` → enum 4 値の写像は完全に決まる。乱数・I/O・外部依存はない。
→ 仕様ループ(spec → test → 実装 → test)で進める。experiments/ は不要。

## 要確認(人間の確定を待つ)

1. 境界の数値 → 推奨は日本のアプリでよくある以下。これを **採用するか別案を選ぶか**。
   - morning  : 05:00–10:59
   - afternoon: 11:00–16:59
   - evening  : 17:00–20:59
   - night    : 21:00–04:59(24 時跨ぎ)
2. 区間の閉じ方は **半開区間 `[start, end)`**(end 排他)で良いか。
3. 引数は **`hour: number`(0–23)** を主とし、Date は薄いラッパで良いか(タイムゾーン処理を engine から追い出す)。
4. 不正値(`hour < 0` / `hour >= 24` / 非整数)はどうするか。
   - 推奨: 24 で剰余 + `Math.floor` で正規化(クラッシュさせない、決定的)。
   - 代替: throw する(早期失敗)。
