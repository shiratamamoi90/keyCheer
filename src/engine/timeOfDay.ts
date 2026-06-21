// timeOfDay: 時(0..23 整数)→ TimeOfDay 4 値の決定的分類。純粋関数。
// spec: changes/0005-timeOfDay-classification/spec.md
// 引数 hour ∈ {0..23 整数} は呼び出し側で保証する(本関数内では検査しない)。

import type { TimeOfDay } from "../shared/types.js";

export const MORNING_START = 5;
export const AFTERNOON_START = 11;
export const EVENING_START = 17;
export const NIGHT_START = 21;

// シナリオ: 朝/昼/夕/夜の代表時刻と各境界(半開区間 [start, end))
export function classifyTimeOfDay(hour: number): TimeOfDay {
  if (hour < MORNING_START) return "night";
  if (hour < AFTERNOON_START) return "morning";
  if (hour < EVENING_START) return "afternoon";
  if (hour < NIGHT_START) return "evening";
  return "night";
}

// シナリオ: Date からの薄いラッパ
export function classifyTimeOfDayFromDate(date: Date): TimeOfDay {
  return classifyTimeOfDay(date.getHours());
}
