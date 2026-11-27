// triggerSettings: 設定画面の「応援」の欄(回数・節目の回数・節目の応援を出すか)。
// 要件: docs/main-window.md S0070_01〜08(論点 0070)
//
// 値域の外の値は画面の操作で作れないようにする(論点 0070 案X)。打つたびに値域で弾くと、
// 1000 を打つ途中の 1 で止まって打てなくなるので、確定したとき(欄から離れる・Enter)にだけ値域に寄せる。
// main 側も同じ値域で検証する(画面を通らない書き換えを防ぐ。S0033_15)。

import { TRIGGER_RANGES, type TriggerConfig } from "../core/shared/types.js";

export type TriggerField = "regular" | "milestoneInterval";

export interface TriggerSettingsController {
  getConfig(): TriggerConfig;
  // 確定した入力を値域に寄せて保存し、欄に出す値を返す
  commitField(field: TriggerField, input: string): number;
  setMilestoneEnabled(isEnabled: boolean): void;
  isMilestoneIntervalEditable(): boolean;
  // 数の欄の min / max(上下の矢印で値域の外へ動かさないため)
  getFieldRange(field: TriggerField): { min: number; max: number };
}

// S0070_07 回数の上限は節目 - 1、節目の下限は回数 + 1 — 回数を節目以上に、節目を回数以下にできない
function computeFieldRange(
  field: TriggerField,
  config: TriggerConfig,
): { min: number; max: number } {
  switch (field) {
    case "regular":
      return {
        min: TRIGGER_RANGES.regular.min,
        max: Math.min(TRIGGER_RANGES.regular.max, config.milestoneInterval - 1),
      };
    case "milestoneInterval":
      return { min: config.regular + 1, max: TRIGGER_RANGES.milestoneInterval.max };
  }
}

export function createTriggerSettingsController(deps: {
  config: TriggerConfig;
  save: (config: TriggerConfig) => void;
}): TriggerSettingsController {
  let config = { ...deps.config };

  const update = (next: TriggerConfig): void => {
    config = next;
    deps.save({ ...next });
  };

  return {
    // S0070_01 保存されている値を出す(保存が無ければ main が既定値で補って渡す)
    getConfig: () => ({ ...config }),

    commitField(field, input) {
      const saved = config[field];
      // S0070_08 節目の応援を出さない間は節目の回数を変えない
      if (field === "milestoneInterval" && !config.isMilestoneEnabled) return saved;
      // S0070_06 空や数でない入力は保存されている値に戻す
      const trimmed = input.trim();
      const parsed = Number(trimmed);
      if (trimmed === "" || !Number.isFinite(parsed)) return saved;
      // S0070_05 小数は切り捨て / S0070_04 範囲の外は端の値
      const { min, max } = computeFieldRange(field, config);
      const value = Math.min(max, Math.max(min, Math.trunc(parsed)));
      // S0070_02 確定した値をすぐ保存する(変わらなければ保存しない)
      if (value !== saved) update({ ...config, [field]: value });
      return value;
    },

    setMilestoneEnabled(isEnabled) {
      if (isEnabled !== config.isMilestoneEnabled)
        update({ ...config, isMilestoneEnabled: isEnabled });
    },

    isMilestoneIntervalEditable: () => config.isMilestoneEnabled,

    getFieldRange: (field) => computeFieldRange(field, config),
  };
}
