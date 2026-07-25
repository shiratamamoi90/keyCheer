// speed-zone: 直近 60 秒の押下数 = KPM、3 段階ゾーン分類。
// spec: specs/speed-zone.md(KPM 窓は 60 秒固定、`activeThresholdSec` とは独立)
// 純粋関数のみ。

import type { SpeedZone } from "../shared/types.js";

// 不変条件: KPM 算出窓は 60 秒固定(設定対象外、`activeThresholdSec` と独立)
export const KPM_WINDOW_MS = 60_000;

// ゾーン境界(下限を含む)。仮置き値 — β で実測して調整する(specs/speed-zone.md [要確認])
export const NORMAL_START_KPM = 100;
export const FAST_START_KPM = 250;

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

// 60 秒窓より古いタイムスタンプを落とす(リングバッファの無制限成長を防ぐ)。
// computeKpm と同じ cutoff(strict less-than)。未来 ts は残す(時計ずれで後に有効化し得るため)。
export function pruneTimestamps(recentTimestamps: readonly number[], now: number): number[] {
  const cutoff = now - KPM_WINDOW_MS;
  return recentTimestamps.filter((t) => t > cutoff);
}

// シナリオ: ゾーン分類(下限を含む方式)
export function classifyZone(kpm: number): SpeedZone {
  if (kpm < NORMAL_START_KPM) return "slow";
  if (kpm < FAST_START_KPM) return "normal";
  return "fast";
}
