import { describe, it, expect } from "vitest";
import { computeKpm, classifyZone, KPM_WINDOW_MS } from "../../src/engine/speedZone.js";

describe("speed-zone / KPM 算出窓は activeThresholdSec とは独立 [不変条件]", () => {
  it("activeThresholdSec を変えても KPM 窓は不変: KPM_WINDOW_MS = 60_000(設定対象外、computeKpm は閾値を受け取らない)", () => {
    expect(KPM_WINDOW_MS).toBe(60_000);
  });
});

describe("speed-zone / computeKpm", () => {
  it("直近1分のキー数で KPM 算出: 直近 60 秒内の押下数を返す", () => {
    // GIVEN 直近 60 秒内に 150 件の押下
    const now = 1_000_000;
    const ts = Array.from({ length: 150 }, (_, i) => now - i * 100); // 100ms 間隔
    expect(computeKpm(ts, now)).toBe(150);
  });

  it("1分より古い押下は除外 [境界]", () => {
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

  it("入力が無い場合: KPM = 0", () => {
    expect(computeKpm([], 1_000_000)).toBe(0);
  });

  it("未来のタイムスタンプは無視する(防御)", () => {
    // GIVEN 時計ずれで未来 ts が混入
    const now = 1_000_000;
    expect(computeKpm([now + 1_000, now - 30_000], now)).toBe(1);
  });
});

describe("speed-zone / classifyZone", () => {
  it("slow ゾーン分類: classifies KPM = 80 as slow", () => {
    expect(classifyZone(80)).toBe("slow");
  });

  it("normal ゾーン分類: classifies KPM = 180 as normal", () => {
    expect(classifyZone(180)).toBe("normal");
  });

  it("fast ゾーン分類: classifies KPM = 300 as fast", () => {
    expect(classifyZone(300)).toBe("fast");
  });

  it("閾値ちょうどの境界: KPM = 100 -> normal (下限を含む)", () => {
    expect(classifyZone(100)).toBe("normal");
  });

  it("boundary: KPM = 99 -> slow", () => {
    expect(classifyZone(99)).toBe("slow");
  });

  it("閾値ちょうどの境界: KPM = 250 -> fast (下限を含む)", () => {
    expect(classifyZone(250)).toBe("fast");
  });

  it("boundary: KPM = 249 -> normal", () => {
    expect(classifyZone(249)).toBe("normal");
  });

  it("KPM = 0 -> slow", () => {
    expect(classifyZone(0)).toBe("slow");
  });
});
