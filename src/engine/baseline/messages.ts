// Baseline 定型文(同梱)。プール未生成・バケット全欠損時のフォールバック。
// 1 文 30 字以内、シナリオキー (zone, type, timeOfDay) ごと。
// 実装は TDD で埋める(spec: cheer-trigger.md / integrations.md)。

import type { SpeedZone, CheerType, TimeOfDay } from "../../shared/types.js";

export type BaselineKey = `${SpeedZone}_${CheerType}_${TimeOfDay}`;

export const baselineMessages: Record<BaselineKey, string[]> = {} as Record<BaselineKey, string[]>;
