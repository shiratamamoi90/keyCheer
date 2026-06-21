import { describe, it, expect } from "vitest";
import { selectCheer } from "../../src/engine/cheerSelector.js";
import { bucketKey, ALL_BUCKET_KEYS, type MessagePool } from "../../src/engine/messagePool.js";
import type { BaselineKey } from "../../src/engine/baseline/messages.js";

// spec: specs/cheer-trigger.md / changes/0002-offline-cheer/spec.md

// テスト用ヘルパ: 全 24 バケットを埋めたプールを作る
function makePool(
  filler: (key: string, index: number) => { id: string; text: string }[],
): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((k, i) => [k, filler(k, i)]),
  ) as MessagePool["buckets"];
  return { characterId: "test", version: 1, buckets };
}

// テスト用: 全シナリオキーで 1 つだけ baseline を持つ
function makeBaseline(text: string): Record<BaselineKey, string[]> {
  return Object.fromEntries(ALL_BUCKET_KEYS.map((k) => [k, [text]])) as Record<
    BaselineKey,
    string[]
  >;
}

describe("cheerSelector", () => {
  describe("シナリオ: プールからの 1 文選択", () => {
    it("picks the first message when random() returns 0", () => {
      const pool = makePool(() => [
        { id: "a", text: "alpha" },
        { id: "b", text: "beta" },
        { id: "c", text: "gamma" },
      ]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.messageId).toBe("a");
      expect(result.text).toBe("alpha");
      expect(result.bucketKey).toBe("fast_regular_evening");
      expect(result.source).toBe("pool");
    });

    it("picks the last message when random() returns near 1", () => {
      const pool = makePool(() => [
        { id: "a", text: "alpha" },
        { id: "b", text: "beta" },
        { id: "c", text: "gamma" },
      ]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0.99,
      });
      expect(result.messageId).toBe("c");
    });
  });

  describe("シナリオ: 同一文の連続再生を避ける(セッション内除外方式)", () => {
    it("excludes the last messageId for this bucket", () => {
      const pool = makePool(() => [
        { id: "a", text: "alpha" },
        { id: "b", text: "beta" },
      ]);
      // 直前に 'a' を出したので、'b' しか残らない
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: { fast_regular_evening: "a" },
        baseline: makeBaseline("BASE"),
        random: () => 0, // would normally pick 'a' but excluded
      });
      expect(result.messageId).toBe("b");
    });

    it("falls back to allowing the last messageId when it is the only entry", () => {
      // バケットに 1 文しかない場合、除外すると 0 になる → 除外を諦めて出す
      const pool = makePool(() => [{ id: "only", text: "lonely" }]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: { fast_regular_evening: "only" },
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.messageId).toBe("only");
      expect(result.source).toBe("pool");
    });

    it("does not exclude based on a different bucket's last messageId", () => {
      const pool = makePool(() => [{ id: "a", text: "alpha" }]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        // 別バケットの履歴は今のバケットに影響しない
        lastMessageIdByBucket: { slow_regular_morning: "a" },
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.messageId).toBe("a");
      expect(result.source).toBe("pool");
    });
  });

  describe("シナリオ: マイルストーン文中の動的数値補間", () => {
    it("replaces {milestone} in milestone-type messages", () => {
      const pool = makePool((k) =>
        k === bucketKey("normal", "milestone", "afternoon")
          ? [{ id: "m1", text: "{milestone} 回達成だよ!" }]
          : [{ id: "x", text: "x" }],
      );
      const result = selectCheer({
        pool,
        zone: "normal",
        type: "milestone",
        timeOfDay: "afternoon",
        milestone: 1000,
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.text).toBe("1000 回達成だよ!");
    });

    it("does NOT interpolate {milestone} in regular-type messages", () => {
      const pool = makePool(() => [{ id: "a", text: "{milestone} は無視" }]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        milestone: 500,
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.text).toBe("{milestone} は無視");
    });

    it("leaves {milestone} as-is when milestone is undefined", () => {
      const pool = makePool(() => [{ id: "m1", text: "{milestone} 回!" }]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "milestone",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.text).toBe("{milestone} 回!");
    });
  });

  describe("シナリオ: 対象バケットが空のときのフォールバック [異常系]", () => {
    it("falls back to another zone with the same (type, timeOfDay)", () => {
      const pool = makePool((k) =>
        k === bucketKey("fast", "milestone", "night")
          ? [] // 対象バケットが空
          : k === bucketKey("normal", "milestone", "night")
            ? [{ id: "fb", text: "別ゾーンの夜マイルストーン" }]
            : [],
      );
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "milestone",
        timeOfDay: "night",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.text).toBe("別ゾーンの夜マイルストーン");
      expect(result.source).toBe("fallback-zone");
    });

    it("falls back to any bucket with the same type when (type, timeOfDay) is exhausted", () => {
      const pool = makePool((k) =>
        k === bucketKey("slow", "milestone", "morning")
          ? [{ id: "fb2", text: "別時間帯マイルストーン" }]
          : [],
      );
      // ターゲット (fast, milestone, night) と同じ (milestone, night) の zone 全空 → 別時間帯
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "milestone",
        timeOfDay: "night",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.text).toBe("別時間帯マイルストーン");
      expect(result.source).toBe("fallback-type");
    });

    it("falls back to baseline when pool has no matching type at all", () => {
      const pool = makePool(() => []); // 全空
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "milestone",
        timeOfDay: "night",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("baseline-night-milestone"),
        random: () => 0,
      });
      expect(result.text).toBe("baseline-night-milestone");
      expect(result.source).toBe("baseline");
    });
  });

  describe("シナリオ: キャラ未作成時の発動 [異常系]", () => {
    it("falls back to baseline when pool is null", () => {
      const result = selectCheer({
        pool: null,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("ベース定型"),
        random: () => 0,
      });
      expect(result.text).toBe("ベース定型");
      expect(result.source).toBe("baseline");
      expect(result.bucketKey).toBe("fast_regular_evening");
    });

    it("interpolates {milestone} in baseline milestone messages too", () => {
      const baseline = makeBaseline("{milestone} 回到達");
      const result = selectCheer({
        pool: null,
        zone: "normal",
        type: "milestone",
        timeOfDay: "afternoon",
        milestone: 5000,
        lastMessageIdByBucket: {},
        baseline,
        random: () => 0,
      });
      expect(result.text).toBe("5000 回到達");
    });
  });

  describe("不変条件: 決定的選択", () => {
    // spec: cheer-trigger.md / 不変条件
    it("returns the same result for the same inputs", () => {
      const pool = makePool(() => [
        { id: "a", text: "alpha" },
        { id: "b", text: "beta" },
        { id: "c", text: "gamma" },
      ]);
      const args = {
        pool,
        zone: "fast" as const,
        type: "regular" as const,
        timeOfDay: "evening" as const,
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0.5,
      };
      const r1 = selectCheer(args);
      const r2 = selectCheer(args);
      expect(r1).toEqual(r2);
    });
  });
});
