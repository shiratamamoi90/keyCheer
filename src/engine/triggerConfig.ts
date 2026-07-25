// trigger-config: 設定値のバリデーション・既定値補完・マイグレーション。
// spec: changes/0004-configurable-triggers/spec.md
// 純粋関数のみ。

import { DEFAULT_TRIGGER_CONFIG, type TriggerConfig } from "../shared/types.js";
export { DEFAULT_TRIGGER_CONFIG };

const LEGACY_REGULAR_DEFAULT = 100;
const MAX_MILESTONES = 20;

export type ValidateResult = { ok: true; value: TriggerConfig } | { ok: false; errors: string[] };

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function validateRegular(v: unknown, errors: string[]): void {
  if (!isInt(v) || (v as number) < 1 || (v as number) > 10_000) {
    errors.push(`regular は 1〜10000 の整数(received: ${String(v)})`);
  }
}

function validateActiveThresholdSec(v: unknown, errors: string[]): void {
  if (!isInt(v) || (v as number) < 5 || (v as number) > 600) {
    errors.push(`activeThresholdSec は 5〜600 の整数(received: ${String(v)})`);
  }
}

function validateMilestones(v: unknown, errors: string[]): void {
  if (!Array.isArray(v)) {
    errors.push(`milestones は配列(received: ${String(v)})`);
    return;
  }
  if (v.length > MAX_MILESTONES) {
    errors.push(`milestones は最大 ${MAX_MILESTONES} 個まで(received: ${v.length})`);
  }
  for (const m of v) {
    if (!isInt(m) || (m as number) < 1) {
      errors.push(`milestones の各要素は 1 以上の整数(received: ${String(m)})`);
      return;
    }
  }
  for (let i = 1; i < v.length; i++) {
    if ((v[i] as number) <= (v[i - 1] as number)) {
      errors.push(`milestones は重複なしの厳密昇順(received: ${JSON.stringify(v)})`);
      return;
    }
  }
}

// シナリオ: 不正値(各種) / マイルストーン空配列の許容 / シェイプ拒否
export function validateTriggerConfig(input: unknown): ValidateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["TriggerConfig は object である必要がある"] };
  }
  const obj = input as Record<string, unknown>;
  if (!("regular" in obj) || !("milestones" in obj) || !("activeThresholdSec" in obj)) {
    return { ok: false, errors: ["必須キーが欠落(regular / milestones / activeThresholdSec)"] };
  }
  const errors: string[] = [];
  validateRegular(obj.regular, errors);
  validateActiveThresholdSec(obj.activeThresholdSec, errors);
  validateMilestones(obj.milestones, errors);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      regular: obj.regular as number,
      milestones: [...(obj.milestones as number[])],
      activeThresholdSec: obj.activeThresholdSec as number,
    },
  };
}

// シナリオ: 旧 JSON の補完(欠損キーを既定値で補完)
export function mergeWithDefaults(partial: Partial<TriggerConfig>): TriggerConfig {
  return {
    regular: partial.regular ?? DEFAULT_TRIGGER_CONFIG.regular,
    milestones: partial.milestones ?? [...DEFAULT_TRIGGER_CONFIG.milestones],
    activeThresholdSec: partial.activeThresholdSec ?? DEFAULT_TRIGGER_CONFIG.activeThresholdSec,
  };
}

// シナリオ: 既存 `triggers.regular = 100`(旧既定)→ 50 にリセット + 通知フラグ
// シナリオ: 以降ユーザーが明示変更した値は尊重する(再上書きしない)
//   移行は **1 回だけ**効く。既に移行済み(alreadyMigrated)なら 100 はユーザーの明示設定として尊重する。
//   移行済みかどうかの永続化は呼び出し側(main/store)の責務(engine は副作用を持たない)。
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
