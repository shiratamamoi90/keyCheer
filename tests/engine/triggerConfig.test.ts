import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRIGGER_CONFIG,
  validateTriggerConfig,
  mergeWithDefaults,
  migrateLegacyDefaults,
} from "../../src/engine/triggerConfig.js";

describe("trigger-config / defaults", () => {
  it("既定値: regular=50, milestones=[1000,5000,10000,50000,100000], activeThresholdSec=60", () => {
    expect(DEFAULT_TRIGGER_CONFIG).toEqual({
      regular: 50,
      milestones: [1000, 5000, 10000, 50000, 100000],
      activeThresholdSec: 60,
    });
  });
});

describe("trigger-config / validateTriggerConfig: regular", () => {
  it("accepts boundary values 1 and 10000", () => {
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, regular: 1 }).ok).toBe(true);
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, regular: 10_000 }).ok).toBe(true);
  });

  it("rejects 0, negative, non-integer, and out-of-upper-bound", () => {
    for (const v of [0, -1, 1.5, 10_001, NaN, Infinity]) {
      const r = validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, regular: v });
      expect(r.ok, `regular=${v} should reject`).toBe(false);
    }
  });
});

describe("trigger-config / validateTriggerConfig: activeThresholdSec", () => {
  it("accepts boundary values 5 and 600", () => {
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, activeThresholdSec: 5 }).ok).toBe(
      true,
    );
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, activeThresholdSec: 600 }).ok).toBe(
      true,
    );
  });

  it("rejects 0, negative, below 5, above 600, and non-integer", () => {
    for (const v of [0, -1, 4, 601, 60.5, NaN]) {
      const r = validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, activeThresholdSec: v });
      expect(r.ok, `activeThresholdSec=${v} should reject`).toBe(false);
    }
  });
});

describe("trigger-config / validateTriggerConfig: milestones", () => {
  it("accepts empty array (milestone OFF)", () => {
    const r = validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [] });
    expect(r.ok).toBe(true);
  });

  it("accepts strictly ascending positive integers", () => {
    const r = validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [1, 100, 1000] });
    expect(r.ok).toBe(true);
  });

  it("rejects values <= 0", () => {
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [0, 100] }).ok).toBe(
      false,
    );
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [-1, 100] }).ok).toBe(
      false,
    );
  });

  it("rejects duplicates", () => {
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [100, 100] }).ok).toBe(
      false,
    );
  });

  it("rejects descending order", () => {
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [1000, 100] }).ok).toBe(
      false,
    );
  });

  it("rejects non-integer values", () => {
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: [1.5, 100] }).ok).toBe(
      false,
    );
  });

  it("rejects more than 20 milestones", () => {
    const ms = Array.from({ length: 21 }, (_, i) => (i + 1) * 100);
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: ms }).ok).toBe(false);
  });

  it("accepts exactly 20 milestones (boundary)", () => {
    const ms = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(validateTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, milestones: ms }).ok).toBe(true);
  });
});

describe("trigger-config / validateTriggerConfig: shape", () => {
  it("rejects entirely missing or malformed input", () => {
    expect(validateTriggerConfig(null).ok).toBe(false);
    expect(validateTriggerConfig(undefined).ok).toBe(false);
    expect(validateTriggerConfig("nope").ok).toBe(false);
    expect(validateTriggerConfig({ regular: 50 }).ok).toBe(false); // 必須キー欠落
  });
});

describe("trigger-config / mergeWithDefaults", () => {
  it("fills missing keys with defaults (旧 JSON 補完)", () => {
    // GIVEN activeThresholdSec キーがない旧 JSON
    const merged = mergeWithDefaults({ regular: 80, milestones: [500] });
    expect(merged).toEqual({
      regular: 80,
      milestones: [500],
      activeThresholdSec: 60,
    });
  });

  it("uses all defaults when partial is empty", () => {
    expect(mergeWithDefaults({})).toEqual(DEFAULT_TRIGGER_CONFIG);
  });

  it("preserves provided values", () => {
    const merged = mergeWithDefaults({
      regular: 25,
      activeThresholdSec: 120,
      milestones: [500],
    });
    expect(merged).toEqual({ regular: 25, milestones: [500], activeThresholdSec: 120 });
  });
});

describe("trigger-config / migrateLegacyDefaults", () => {
  it("resets regular=100 (legacy default) to 50 and flags migrated", () => {
    const result = migrateLegacyDefaults({
      regular: 100,
      milestones: [1000, 5000, 10000, 50000, 100000],
      activeThresholdSec: 60,
    });
    expect(result.config.regular).toBe(50);
    expect(result.migrated).toBe(true);
  });

  it("preserves user-set regular if not legacy default", () => {
    const result = migrateLegacyDefaults({
      regular: 30,
      milestones: [1000],
      activeThresholdSec: 60,
    });
    expect(result.config.regular).toBe(30);
    expect(result.migrated).toBe(false);
  });

  it("preserves regular=50 (new default already in effect)", () => {
    const result = migrateLegacyDefaults({
      regular: 50,
      milestones: [1000],
      activeThresholdSec: 60,
    });
    expect(result.config.regular).toBe(50);
    expect(result.migrated).toBe(false);
  });
});
