import { describe, it, expect } from "vitest";
import { computeKpm, classifyZone, KPM_WINDOW_MS } from "../../src/engine/speedZone.js";

describe("speed-zone / KPM_WINDOW_MS は 60 秒固定 [不変条件]", () => {
  it("KPM 算出窓は 60_000ms(設定対象外)", () => {
    expect(KPM_WINDOW_MS).toBe(60_000);
  });
});

describe("speed-zone / computeKpm", () => {
  it("直近 60 秒内の押下数を返す", () => {
    // GIVEN 直近 60 秒内に 150 件の押下
    const now = 1_000_000;
    const ts = Array.from({ length: 150 }, (_, i) => now - i * 100); // 100ms 間隔
    expect(computeKpm(ts, now)).toBe(150);
  });

  it("1 分より古い押下を除外 [境界]", () => {
    // GIVEN 61 秒前 / 30 秒前 各 1 件
    const now = 1_000_000;
    const ts = [now - 61_000, now - 30_000];
    expect(computeKpm(ts, now)).toBe(1);
  });

  it("60 秒ちょうどは窓外(strict less-than)", () => {
    // GIVEN 60 秒ちょうどの押下
    const now = 1_000_000;
    expect(computeKpm([now - 60_000], now)).toBe(0);
    expect(computeKpm([now - 59_999], now)).toBe(1);
  });

  it("入力なしは 0", () => {
    expect(computeKpm([], 1_000_000)).toBe(0);
  });

  it("未来のタイムスタンプは無視する(防御)", () => {
    // GIVEN 時計ずれで未来 ts が混入
    const now = 1_000_000;
    expect(computeKpm([now + 1_000, now - 30_000], now)).toBe(1);
  });
});

describe("speed-zone / classifyZone", () => {
  it("classifies KPM = 80 as slow", () => {
    expect(classifyZone(80)).toBe("slow");
  });

  it("classifies KPM = 180 as normal", () => {
    expect(classifyZone(180)).toBe("normal");
  });

  it("classifies KPM = 300 as fast", () => {
    expect(classifyZone(300)).toBe("fast");
  });

  it("boundary: KPM = 100 -> normal (下限を含む)", () => {
    expect(classifyZone(100)).toBe("normal");
  });

  it("boundary: KPM = 99 -> slow", () => {
    expect(classifyZone(99)).toBe("slow");
  });

  it("boundary: KPM = 250 -> fast (下限を含む)", () => {
    expect(classifyZone(250)).toBe("fast");
  });

  it("boundary: KPM = 249 -> normal", () => {
    expect(classifyZone(249)).toBe("normal");
  });

  it("KPM = 0 -> slow", () => {
    expect(classifyZone(0)).toBe("slow");
  });
});
