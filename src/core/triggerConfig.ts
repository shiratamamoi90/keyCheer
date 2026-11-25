// trigger-config: 設定値のバリデーション・既定値補完・マイグレーション。
// spec: 論点 0009 / 0071(docs/data-model.md)
// 純粋関数のみ。

import { DEFAULT_TRIGGER_CONFIG, TRIGGER_RANGES, type TriggerConfig } from "./shared/types.js";
export { DEFAULT_TRIGGER_CONFIG };

const LEGACY_REGULAR_DEFAULT = 100;
// 既定の節目が回数以下になるときの倍率(既定の 50 と 250 の比。論点 0071 決定 6)
const MILESTONE_TO_REGULAR_RATIO = 5;

export type ValidateResult = { ok: true; value: TriggerConfig } | { ok: false; errors: string[] };

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function isRegularValid(v: unknown): v is number {
  return isIntInRange(v, TRIGGER_RANGES.regular.min, TRIGGER_RANGES.regular.max);
}

function isActiveThresholdSecValid(v: unknown): v is number {
  return isIntInRange(
    v,
    TRIGGER_RANGES.activeThresholdSec.min,
    TRIGGER_RANGES.activeThresholdSec.max,
  );
}

// S0071_08 節目は回数より大きい — 節目の応援を出さない設定でも同じ(ON に戻したときに不正にならないため)
function isMilestoneIntervalValid(v: unknown, regular: number): v is number {
  return isIntInRange(v, regular + 1, TRIGGER_RANGES.milestoneInterval.max);
}

const REQUIRED_KEYS = [
  "regular",
  "activeThresholdSec",
  "milestoneInterval",
  "isMilestoneEnabled",
] as const;

// S0071_07 値域の中の値だけを受け付ける
export function validateTriggerConfig(input: unknown): ValidateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["TriggerConfig は object である必要がある"] };
  }
  const obj = input as Record<string, unknown>;
  if (REQUIRED_KEYS.some((key) => !(key in obj))) {
    return { ok: false, errors: [`必須キーが欠落(${REQUIRED_KEYS.join(" / ")})`] };
  }
  const errors: string[] = [];
  const { regular, activeThresholdSec, milestoneInterval, isMilestoneEnabled } = obj;
  if (!isRegularValid(regular)) {
    errors.push(`regular は 1〜10000 の整数(received: ${String(regular)})`);
  }
  if (!isActiveThresholdSecValid(activeThresholdSec)) {
    errors.push(`activeThresholdSec は 5〜600 の整数(received: ${String(activeThresholdSec)})`);
  }
  if (isRegularValid(regular) && !isMilestoneIntervalValid(milestoneInterval, regular)) {
    errors.push(
      `milestoneInterval は regular + 1〜100000 の整数(received: ${String(milestoneInterval)})`,
    );
  }
  if (typeof isMilestoneEnabled !== "boolean") {
    errors.push(`isMilestoneEnabled は真偽値(received: ${String(isMilestoneEnabled)})`);
  }
  if (errors.length > 0) return { ok: false, errors };
  // 余分なキー(前の版の milestones など)は値に持ち込まない
  return {
    ok: true,
    value: {
      regular: regular as number,
      activeThresholdSec: activeThresholdSec as number,
      milestoneInterval: milestoneInterval as number,
      isMilestoneEnabled: isMilestoneEnabled as boolean,
    },
  };
}

// S0015_01 / S0071_06 欠けたキーを既定値で補う
export function mergeWithDefaults(partial: Partial<TriggerConfig>): TriggerConfig {
  return {
    regular: partial.regular ?? DEFAULT_TRIGGER_CONFIG.regular,
    activeThresholdSec: partial.activeThresholdSec ?? DEFAULT_TRIGGER_CONFIG.activeThresholdSec,
    milestoneInterval: partial.milestoneInterval ?? DEFAULT_TRIGGER_CONFIG.milestoneInterval,
    isMilestoneEnabled: partial.isMilestoneEnabled ?? DEFAULT_TRIGGER_CONFIG.isMilestoneEnabled,
  };
}

// S0071_10 / S0071_11 前の版の節目の一覧を、節目を出すかに移して一覧を消す。
// 一覧の値は使わない(論点 0071 案X:大半が旧既定の一覧で、その最初の 1000 より既定の 250 が 0069 の意図に合う)。
// 回数は欠けたままにして、mergeWithDefaults と applyTriggerConfigRepair に既定値と直し方を任せる(S0071_12)
export function applyLegacyMilestonesMigration(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(raw.milestones)) return raw;
  const { milestones, ...rest } = raw;
  return { ...rest, isMilestoneEnabled: (milestones as unknown[]).length > 0 };
}

// S0071_09 読み込んだ値が値域の外なら、外の値だけを直す(手で書き換えた設定で起動を止めない)。
// 節目は回数を直した後に見る — 回数の値で節目の値域が決まるため
export function applyTriggerConfigRepair(config: TriggerConfig): {
  config: TriggerConfig;
  errors: string[];
} {
  const errors: string[] = [];
  const regular = isRegularValid(config.regular) ? config.regular : DEFAULT_TRIGGER_CONFIG.regular;
  if (regular !== config.regular)
    errors.push(`regular を既定値に戻した(${String(config.regular)})`);

  const activeThresholdSec = isActiveThresholdSecValid(config.activeThresholdSec)
    ? config.activeThresholdSec
    : DEFAULT_TRIGGER_CONFIG.activeThresholdSec;
  if (activeThresholdSec !== config.activeThresholdSec) {
    errors.push(`activeThresholdSec を既定値に戻した(${String(config.activeThresholdSec)})`);
  }

  let milestoneInterval = config.milestoneInterval;
  if (!isMilestoneIntervalValid(milestoneInterval, regular)) {
    milestoneInterval = isMilestoneIntervalValid(DEFAULT_TRIGGER_CONFIG.milestoneInterval, regular)
      ? DEFAULT_TRIGGER_CONFIG.milestoneInterval
      : regular * MILESTONE_TO_REGULAR_RATIO;
    errors.push(
      `milestoneInterval を ${milestoneInterval} にした(${String(config.milestoneInterval)})`,
    );
  }

  const isMilestoneEnabled =
    typeof config.isMilestoneEnabled === "boolean"
      ? config.isMilestoneEnabled
      : DEFAULT_TRIGGER_CONFIG.isMilestoneEnabled;
  if (isMilestoneEnabled !== config.isMilestoneEnabled) {
    errors.push(`isMilestoneEnabled を既定値に戻した(${String(config.isMilestoneEnabled)})`);
  }

  return { config: { regular, activeThresholdSec, milestoneInterval, isMilestoneEnabled }, errors };
}

// S0015_02 既存 `triggers.regular = 100`(旧既定)→ 50 にリセット + 通知フラグ
//   移行は **1 回だけ**効く。既に移行済み(alreadyMigrated)なら 100 はユーザーの明示設定として尊重する。
//   移行済みかどうかの永続化は呼び出し側(main/store)の責務(core は副作用を持たない)。
export function migrateLegacyDefaults(
  config: TriggerConfig,
  alreadyMigrated = false,
): {
  config: TriggerConfig;
  migrated: boolean;
} {
  if (!alreadyMigrated && config.regular === LEGACY_REGULAR_DEFAULT) {
    return {
      config: { ...config, regular: DEFAULT_TRIGGER_CONFIG.regular },
      migrated: true,
    };
  }
  return { config, migrated: false };
}
