// trigger: 発動判定(通常 / マイルストーン / 発動なし)。
// spec: specs/cheer-trigger.md + changes/0004-configurable-triggers/spec.md
// 純粋関数のみ。milestone を regular より優先。

import type { CheerType } from "../shared/types.js";

interface TriggerConfigLike {
  regular: number;
  milestones: readonly number[];
}

// シナリオ: 通常応援 / マイルストーン優先 / 倍数以外は null / 空配列(milestone OFF)
export function shouldFire(count: number, config: TriggerConfigLike): CheerType | null {
  if (count <= 0) return null;
  if (config.milestones.includes(count)) return "milestone";
  if (config.regular > 0 && count % config.regular === 0) return "regular";
  return null;
}
