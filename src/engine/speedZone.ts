// speed-zone: 直近 60 秒の押下数 = KPM、3 段階ゾーン分類。
// spec: specs/speed-zone.md(KPM 窓は 60 秒固定、`activeThresholdSec` とは独立)
// 純粋関数のみ。

import type { SpeedZone } from "../shared/types.js";

// 不変条件: KPM 算出窓は 60 秒固定(設定対象外、`activeThresholdSec` と独立)
export const KPM_WINDOW_MS = 60_000;

// シナリオ: 直近 60 秒のキー数 / 1 分より古いを除外 / 入力なしは 0
export function computeKpm(recentTimestamps: readonly number[], now: number): number {
  const cutoff = now - KPM_WINDOW_MS;
  let count = 0;
  for (const t of recentTimestamps) {
    // strict less-than(`cutoff` ちょうど = 窓外)、未来 ts は防御で除外
    if (t > cutoff && t <= now) count++;
  }
  return count;
}

// シナリオ: ゾーン分類(下限を含む方式)
export function classifyZone(kpm: number): SpeedZone {
  if (kpm < 100) return "slow";
  if (kpm < 250) return "normal";
  return "fast";
}
