import { describe, it, expect } from "vitest";
import { shouldFire } from "../../src/core/trigger.js";
import { DEFAULT_TRIGGER_CONFIG } from "../../src/core/triggerConfig.js";

// 節目の応援を出さない設定(通常の応援だけを見るテストの前提)
const OFF50 = { regular: 50, milestoneInterval: 250, isMilestoneEnabled: false };
const OFF30 = { regular: 30, milestoneInterval: 250, isMilestoneEnabled: false };
const ON = { regular: 50, milestoneInterval: 250, isMilestoneEnabled: true };

describe("trigger / 通常応援を N 回ごとに発動", () => {
  it("S0013_01 fires regular when count reaches a multiple of `regular`", () => {
    // GIVEN regular=50、カウントが 50 に到達
    expect(shouldFire(50, OFF50)).toBe("regular");
    expect(shouldFire(100, OFF50)).toBe("regular");
  });

  it("S0013_02 倍数以外では発動しない [境界]", () => {
    // GIVEN regular=50
    expect(shouldFire(49, OFF50)).toBeNull();
    expect(shouldFire(51, OFF50)).toBeNull();
  });

  it("does not fire on count=0 (initial state)", () => {
    expect(shouldFire(0, DEFAULT_TRIGGER_CONFIG)).toBeNull();
  });

  it("uses the configured regular interval (smaller value)", () => {
    expect(shouldFire(30, OFF30)).toBe("regular");
    expect(shouldFire(60, OFF30)).toBe("regular");
    expect(shouldFire(31, OFF30)).toBeNull();
  });
});

describe("trigger / 節目の回数ごとに節目の応援を繰り返す", () => {
  it("S0071_01 fires milestone at every multiple of milestoneInterval, not only the first", () => {
    // GIVEN regular=50・milestoneInterval=250・出す、カウントが 500(2 回目の倍数)
    expect(shouldFire(500, ON)).toBe("milestone");
  });
});

describe("trigger / 節目の倍数でなければ節目の応援を出さない [境界]", () => {
  it("S0071_02 fires regular, not milestone, at a multiple of regular only", () => {
    expect(shouldFire(300, ON)).toBe("regular");
  });
});

describe("trigger / 通常の応援と重なったら節目だけを出す [否定]", () => {
  it("S0071_03 returns only milestone when both multiples match", () => {
    expect(shouldFire(750, ON)).toBe("milestone");
  });
});

describe("trigger / 節目の応援を出さない設定では節目を出さない [境界]", () => {
  it("S0071_04 fires regular instead of milestone while milestones are disabled", () => {
    expect(shouldFire(250, { ...ON, isMilestoneEnabled: false })).toBe("regular");
  });
});

describe("trigger / default config 動作", () => {
  it("既定 regular=50、milestoneInterval=250(論点 0071)", () => {
    expect(shouldFire(50, DEFAULT_TRIGGER_CONFIG)).toBe("regular");
    expect(shouldFire(250, DEFAULT_TRIGGER_CONFIG)).toBe("milestone"); // milestone 優先
    expect(shouldFire(25_250, DEFAULT_TRIGGER_CONFIG)).toBe("milestone"); // 旧既定の最大を超えても出る
    expect(shouldFire(49, DEFAULT_TRIGGER_CONFIG)).toBeNull();
  });
});

describe("trigger / 決定性 [不変条件]", () => {
  it("同じ入力に対し常に同じ結果を返す(副作用なし)", () => {
    const cfg = { ...ON };
    const a = shouldFire(1000, cfg);
    const b = shouldFire(1000, cfg);
    expect(a).toBe(b);
    // 引数 cfg は変更されない
    expect(cfg).toEqual(ON);
  });
});
