// trigger: 発動判定(通常 / マイルストーン / 発動なし)。
// 要件: docs/cheer-trigger.md + 論点 0009 / 0071
// 純粋関数のみ。milestone を regular より優先。

import type { CheerType, TriggerConfig } from "./shared/types.js";

type TriggerConfigLike = Pick<
  TriggerConfig,
  "regular" | "milestoneInterval" | "isMilestoneEnabled"
>;

// S0071_01 節目の回数ごとに繰り返す / S0071_03 重なったら節目だけ / S0071_04 出さない設定では節目を出さない
// 一覧の値に一致したときだけ出す前の形(論点 0069 まで)は、累計が最大を超えると二度と出なかった(論点 0071)
export function shouldFire(count: number, config: TriggerConfigLike): CheerType | null {
  if (count <= 0) return null;
  if (config.isMilestoneEnabled && count % config.milestoneInterval === 0) return "milestone";
  if (count % config.regular === 0) return "regular";
  return null;
}
