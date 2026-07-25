import { describe, it, expect } from "vitest";
import { shouldFire } from "../../src/engine/trigger.js";
import { DEFAULT_TRIGGER_CONFIG } from "../../src/engine/triggerConfig.js";

describe("trigger / 通常応援を N 回ごとに発動", () => {
  it("fires regular when count reaches a multiple of `regular`", () => {
    // GIVEN regular=50、カウントが 50 に到達
    expect(shouldFire(50, { regular: 50, milestones: [] })).toBe("regular");
    expect(shouldFire(100, { regular: 50, milestones: [] })).toBe("regular");
  });

  it("倍数以外では発動しない [境界]", () => {
    // GIVEN regular=50
    expect(shouldFire(49, { regular: 50, milestones: [] })).toBeNull();
    expect(shouldFire(51, { regular: 50, milestones: [] })).toBeNull();
  });

  it("does not fire on count=0 (initial state)", () => {
    expect(shouldFire(0, DEFAULT_TRIGGER_CONFIG)).toBeNull();
  });

  it("uses the configured regular interval (smaller value)", () => {
    expect(shouldFire(30, { regular: 30, milestones: [] })).toBe("regular");
    expect(shouldFire(60, { regular: 30, milestones: [] })).toBe("regular");
    expect(shouldFire(31, { regular: 30, milestones: [] })).toBeNull();
  });
});

describe("trigger / マイルストーン発動", () => {
  it("fires milestone when count matches a milestone value", () => {
    // GIVEN milestones=[1000,5000,10000]、カウントが 1000
    expect(shouldFire(1000, { regular: 50, milestones: [1000, 5000, 10000] })).toBe("milestone");
    expect(shouldFire(5000, { regular: 50, milestones: [1000, 5000, 10000] })).toBe("milestone");
  });

  it("milestone takes priority over regular when both match", () => {
    // GIVEN regular=50、milestones=[1000]、カウント=1000(両条件成立)
    expect(shouldFire(1000, { regular: 50, milestones: [1000] })).toBe("milestone");
  });

  it("milestone does not fire on near-but-not-equal counts", () => {
    expect(shouldFire(999, { regular: 100, milestones: [1000] })).toBeNull();
    expect(shouldFire(1001, { regular: 100, milestones: [1000] })).toBeNull();
  });
});

describe("trigger / マイルストーン空配列(milestone OFF)[境界]", () => {
  it("only regular fires when milestones is empty", () => {
    expect(shouldFire(1000, { regular: 50, milestones: [] })).toBe("regular");
    expect(shouldFire(1001, { regular: 50, milestones: [] })).toBeNull();
  });
});

describe("trigger / default config 動作", () => {
  it("既定 regular=50、milestones=[1000,5000,...]", () => {
    expect(shouldFire(50, DEFAULT_TRIGGER_CONFIG)).toBe("regular");
    expect(shouldFire(1000, DEFAULT_TRIGGER_CONFIG)).toBe("milestone"); // milestone 優先
    expect(shouldFire(100_000, DEFAULT_TRIGGER_CONFIG)).toBe("milestone");
    expect(shouldFire(49, DEFAULT_TRIGGER_CONFIG)).toBeNull();
  });
});

describe("trigger / 決定性 [不変条件]", () => {
  it("同じ入力に対し常に同じ結果を返す(副作用なし)", () => {
    const cfg = { regular: 50, milestones: [1000] };
    const a = shouldFire(1000, cfg);
    const b = shouldFire(1000, cfg);
    expect(a).toBe(b);
    // 引数 cfg は変更されない
    expect(cfg).toEqual({ regular: 50, milestones: [1000] });
  });
});
