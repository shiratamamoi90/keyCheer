import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRIGGER_CONFIG,
  validateTriggerConfig,
  mergeWithDefaults,
  migrateLegacyDefaults,
  applyLegacyMilestonesMigration,
  applyTriggerConfigRepair,
} from "../../src/core/triggerConfig.js";

const VALID = {
  regular: 50,
  activeThresholdSec: 60,
  milestoneInterval: 250,
  isMilestoneEnabled: true,
};

describe("trigger-config / defaults", () => {
  it("既定値: regular=50, activeThresholdSec=60, milestoneInterval=250, isMilestoneEnabled=true", () => {
    expect(DEFAULT_TRIGGER_CONFIG).toEqual({
      regular: 50,
      activeThresholdSec: 60,
      milestoneInterval: 250,
      isMilestoneEnabled: true,
    });
  });
});

describe("trigger-config / `triggers` の値域の中の値だけを保存する [境界]", () => {
  it("S0071_07 accepts the documented ranges and rejects anything outside them", () => {
    for (const ok of [
      { regular: 1, activeThresholdSec: 5, milestoneInterval: 2, isMilestoneEnabled: true },
      {
        regular: 10_000,
        activeThresholdSec: 600,
        milestoneInterval: 100_000,
        isMilestoneEnabled: false,
      },
    ]) {
      expect(validateTriggerConfig(ok).ok, JSON.stringify(ok)).toBe(true);
    }
    for (const bad of [
      { ...VALID, regular: 0 },
      { ...VALID, regular: 10_001 },
      { ...VALID, regular: 1.5 },
      { ...VALID, activeThresholdSec: 4 },
      { ...VALID, activeThresholdSec: 601 },
      { ...VALID, milestoneInterval: 100_001 },
      { ...VALID, milestoneInterval: 250.5 },
      { ...VALID, isMilestoneEnabled: "yes" },
    ]) {
      expect(validateTriggerConfig(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("trigger-config / 節目が回数以下になる保存は拒否する [否定]", () => {
  it("S0071_08 rejects milestoneInterval <= regular, even while milestones are disabled", () => {
    expect(validateTriggerConfig({ ...VALID, regular: 250, milestoneInterval: 250 }).ok).toBe(
      false,
    );
    expect(
      validateTriggerConfig({ ...VALID, isMilestoneEnabled: false, milestoneInterval: 40 }).ok,
    ).toBe(false);
  });
});

describe("trigger-config / validateTriggerConfig: shape", () => {
  it("rejects entirely missing or malformed input", () => {
    expect(validateTriggerConfig(null).ok).toBe(false);
    expect(validateTriggerConfig(undefined).ok).toBe(false);
    expect(validateTriggerConfig("nope").ok).toBe(false);
    expect(validateTriggerConfig({ regular: 50 }).ok).toBe(false); // 必須キー欠落
  });

  it("does not carry extra keys (e.g. the former milestones) into the value", () => {
    const r = validateTriggerConfig({ ...VALID, milestones: [1000] });
    expect(r.ok && r.value).toEqual(VALID);
  });
});

describe("trigger-config / mergeWithDefaults", () => {
  it("fills missing keys with defaults (旧 JSON 補完)", () => {
    expect(mergeWithDefaults({ regular: 80 })).toEqual({ ...DEFAULT_TRIGGER_CONFIG, regular: 80 });
  });

  it("uses all defaults when partial is empty", () => {
    expect(mergeWithDefaults({})).toEqual(DEFAULT_TRIGGER_CONFIG);
  });
});

describe("trigger-config / applyLegacyMilestonesMigration", () => {
  it("turns a non-empty legacy list into enabled and drops the list", () => {
    expect(applyLegacyMilestonesMigration({ regular: 50, milestones: [1000, 5000] })).toEqual({
      regular: 50,
      isMilestoneEnabled: true,
    });
  });

  it("turns an empty legacy list into disabled", () => {
    expect(applyLegacyMilestonesMigration({ milestones: [] })).toEqual({
      isMilestoneEnabled: false,
    });
  });

  it("leaves a stored value without the legacy list as it is (no mutation)", () => {
    const raw = { regular: 50, milestoneInterval: 500 };
    const result = applyLegacyMilestonesMigration(raw);
    expect(result).toEqual(raw);
    expect(raw).toEqual({ regular: 50, milestoneInterval: 500 });
  });
});

describe("trigger-config / applyTriggerConfigRepair", () => {
  it("keeps a valid config with no errors", () => {
    expect(applyTriggerConfigRepair(VALID)).toEqual({ config: VALID, errors: [] });
  });

  it("replaces only the out-of-range fields with defaults", () => {
    const { config, errors } = applyTriggerConfigRepair({
      ...VALID,
      regular: 0,
      activeThresholdSec: 90,
    });
    expect(config).toEqual({ ...VALID, regular: 50, activeThresholdSec: 90 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("sets milestoneInterval to five times regular when the default is not above regular", () => {
    const { config } = applyTriggerConfigRepair({ ...VALID, regular: 300, milestoneInterval: 200 });
    expect(config).toEqual({ ...VALID, regular: 300, milestoneInterval: 1500 });
  });
});

describe("trigger-config / migrateLegacyDefaults", () => {
  it("resets regular=100 (legacy default) to 50 and flags migrated", () => {
    const result = migrateLegacyDefaults({ ...VALID, regular: 100 });
    expect(result.config.regular).toBe(50);
    expect(result.migrated).toBe(true);
  });

  it("preserves user-set regular if not legacy default", () => {
    const result = migrateLegacyDefaults({ ...VALID, regular: 30 });
    expect(result.config.regular).toBe(30);
    expect(result.migrated).toBe(false);
  });

  // docs/data-model.md「以降ユーザーが明示変更した値は尊重する(再上書きしない)」
  it("以降ユーザーが明示変更した値は尊重する: keeps a user-set 100 once the migration already ran", () => {
    const result = migrateLegacyDefaults({ ...VALID, regular: 100 }, true);
    expect(result.config.regular).toBe(100);
    expect(result.migrated).toBe(false);
  });
});
