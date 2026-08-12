import { describe, it, expect } from "vitest";
import { onKeyPress, initialRuntimeState, type RuntimeState } from "../../src/core/runtime.js";
import { ALL_BUCKET_KEYS, bucketKey, type MessagePool } from "../../src/core/messagePool.js";
import type { BaselineKey } from "../../src/core/baseline/messages.js";
import { DEFAULT_TRIGGER_CONFIG } from "../../src/core/shared/types.js";

// 要件: docs/key-counter.md / speed-zone.md / cheer-trigger.md を合成した per-keypress の決定的処理。
// 発動経路の中核: 1 キー押下 → 状態更新 →(条件を満たせば)応援選択。外部依存ゼロ。

function makePool(filler: (k: string) => { id: string; text: string }[]): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((k) => [k, filler(k)]),
  ) as MessagePool["buckets"];
  return { characterId: "test", version: 1, buckets };
}
function makeBaseline(text: string): Record<BaselineKey, string[]> {
  return Object.fromEntries(ALL_BUCKET_KEYS.map((k) => [k, [text]])) as Record<
    BaselineKey,
    string[]
  >;
}

const HOUR_EVENING = 18; // → "evening"
const baseInput = () => ({
  now: 1_000_000,
  hour: HOUR_EVENING,
  config: DEFAULT_TRIGGER_CONFIG,
  pool: makePool(() => [{ id: "a", text: "alpha" }]),
  baseline: makeBaseline("BASE"),
  random: () => 0,
});

describe("runtime / カウント加算・非発動", () => {
  it("increments count and does not fire on a non-trigger count", () => {
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 10, lastKeyTimestamp: 999_000, activeMs: 0 },
    };
    const result = onKeyPress({ ...baseInput(), state });
    expect(result.state.counter.count).toBe(11); // regular=50 の倍数でない
    expect(result.cheer).toBeNull();
  });

  it("does not mutate the input state (pure)", () => {
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 10, lastKeyTimestamp: 999_000, activeMs: 0 },
      recentKeyTimestamps: [999_000],
    };
    const snapshot = JSON.parse(JSON.stringify(state));
    onKeyPress({ ...baseInput(), state });
    expect(state).toEqual(snapshot);
  });
});

describe("runtime / KPM 算出と剪定", () => {
  it("computes kpm from recent timestamps and prunes entries older than 60s", () => {
    const now = 1_000_000;
    // 59s 前(窓内)、61s 前(窓外)、30s 前(窓内)
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 5, lastKeyTimestamp: now - 100, activeMs: 0 },
      recentKeyTimestamps: [now - 61_000, now - 59_000, now - 30_000],
    };
    const result = onKeyPress({ ...baseInput(), now, state });
    // 61s 前は剪定され、残りは 59s前 + 30s前 + 今 = 3
    expect(result.state.recentKeyTimestamps).not.toContain(now - 61_000);
    expect(result.state.recentKeyTimestamps).toContain(now);
    expect(result.cheer).toBeNull(); // count 6, 非発動
  });
});

describe("runtime / 通常応援の発動", () => {
  it("S0013_04 fires regular at a multiple of triggers.regular with zone + timeOfDay", () => {
    const now = 1_000_000;
    // count 49 → 50 で発動。KPM を fast にするため直近 60s に 300 件
    const recent = Array.from({ length: 300 }, (_, i) => now - i * 100);
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 49, lastKeyTimestamp: now - 100, activeMs: 0 },
      recentKeyTimestamps: recent,
    };
    const result = onKeyPress({ ...baseInput(), now, state });
    expect(result.cheer).not.toBeNull();
    expect(result.cheer!.type).toBe("regular");
    expect(result.cheer!.count).toBe(50);
    expect(result.cheer!.speedZone).toBe("fast");
    expect(result.cheer!.timeOfDay).toBe("evening");
    expect(result.cheer!.message).toBe("alpha");
  });
});

describe("runtime / マイルストーン発動と数値補間", () => {
  it("S0013_03 fires milestone and interpolates {milestone} with the reached count", () => {
    const now = 1_000_000;
    const pool = makePool((k) =>
      k === bucketKey("slow", "milestone", "evening")
        ? [{ id: "m", text: "{milestone}回達成!" }]
        : [{ id: "x", text: "x" }],
    );
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 999, lastKeyTimestamp: now - 100, activeMs: 0 },
    };
    const result = onKeyPress({ ...baseInput(), now, pool, state });
    expect(result.cheer!.type).toBe("milestone");
    expect(result.cheer!.count).toBe(1000);
    expect(result.cheer!.message).toBe("1000回達成!");
  });
});

describe("runtime / 連続回避(sourceBucketKey で記録)", () => {
  it("records the selected message under sourceBucketKey and excludes it next time", () => {
    const now = 1_000_000;
    const pool = makePool(() => [
      { id: "a", text: "alpha" },
      { id: "b", text: "beta" },
    ]);
    // 1 回目: count 49→50 発動、a を選ぶ(random=0)
    const s1: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 49, lastKeyTimestamp: now - 100, activeMs: 0 },
    };
    const r1 = onKeyPress({ ...baseInput(), now, pool, state: s1 });
    expect(r1.cheer!.messageId).toBe("a");
    const bucket = r1.cheer!.sourceBucketKey;
    expect(r1.state.lastMessageIdByBucket[bucket]).toBe("a");

    // 2 回目: 同じバケットで再発動(count 99→100)、a は除外され b
    const s2: RuntimeState = {
      ...r1.state,
      counter: { count: 99, lastKeyTimestamp: now, activeMs: 0 },
    };
    const r2 = onKeyPress({ ...baseInput(), now: now + 1, pool, state: s2 });
    expect(r2.cheer!.messageId).toBe("b");
  });
});

describe("runtime / キャラ未作成(baseline)発動", () => {
  it("fires from baseline when pool is null", () => {
    const now = 1_000_000;
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 49, lastKeyTimestamp: now - 100, activeMs: 0 },
    };
    const result = onKeyPress({ ...baseInput(), now, pool: null, state });
    expect(result.cheer!.message).toBe("BASE");
  });
});

describe("runtime / 選択元の由来(source)を発動イベントに載せる", () => {
  it("reports source=baseline so callers need not parse the messageId", () => {
    const now = 1_000_000;
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 49, lastKeyTimestamp: now - 100, activeMs: 0 },
    };
    const result = onKeyPress({ ...baseInput(), now, pool: null, state });
    expect(result.cheer!.source).toBe("baseline");
  });

  it("reports source=pool when the target bucket hits", () => {
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 49, lastKeyTimestamp: 999_900, activeMs: 0 },
    };
    const result = onKeyPress({ ...baseInput(), state });
    expect(result.cheer!.source).toBe("pool");
  });
});

describe("runtime / 決定性 [不変条件]", () => {
  it("S0014_11 returns the same result for the same inputs", () => {
    const state: RuntimeState = {
      ...initialRuntimeState,
      counter: { count: 49, lastKeyTimestamp: 999_900, activeMs: 0 },
    };
    const r1 = onKeyPress({ ...baseInput(), state });
    const r2 = onKeyPress({ ...baseInput(), state });
    expect(r1).toEqual(r2);
  });
});
