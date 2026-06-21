import { describe, it, expect } from "vitest";
import {
  bucketKey,
  ALL_BUCKET_KEYS,
  EXPECTED_BUCKET_COUNT,
  isValidPool,
  countMessages,
  type MessagePool,
} from "../../src/engine/messagePool.js";

// spec: specs/data-model.md, specs/cheer-trigger.md, changes/0002-offline-cheer/spec.md
describe("messagePool", () => {
  describe("bucketKey: シナリオキーの決定的生成", () => {
    // spec: cheer-trigger.md / "発動時に現在の (zone, timeOfDay) を付与"
    it("composes (fast, regular, evening) into 'fast_regular_evening'", () => {
      expect(bucketKey("fast", "regular", "evening")).toBe("fast_regular_evening");
    });

    it("composes (slow, milestone, morning) into 'slow_milestone_morning'", () => {
      expect(bucketKey("slow", "milestone", "morning")).toBe("slow_milestone_morning");
    });

    it("composes (normal, milestone, afternoon) into 'normal_milestone_afternoon'", () => {
      expect(bucketKey("normal", "milestone", "afternoon")).toBe("normal_milestone_afternoon");
    });
  });

  describe("ALL_BUCKET_KEYS: 24 シナリオ網羅", () => {
    // spec: data-model.md / "zone × type × timeOfDay = 3 × 2 × 4 = 24 シナリオ"
    it("contains exactly 24 unique keys", () => {
      expect(ALL_BUCKET_KEYS).toHaveLength(EXPECTED_BUCKET_COUNT);
      expect(EXPECTED_BUCKET_COUNT).toBe(24);
      expect(new Set(ALL_BUCKET_KEYS).size).toBe(24);
    });

    it("includes every (zone, type, timeOfDay) combination", () => {
      const zones = ["slow", "normal", "fast"] as const;
      const types = ["regular", "milestone"] as const;
      const tods = ["morning", "afternoon", "evening", "night"] as const;
      for (const z of zones) {
        for (const t of types) {
          for (const d of tods) {
            expect(ALL_BUCKET_KEYS).toContain(bucketKey(z, t, d));
          }
        }
      }
    });
  });

  describe("isValidPool: プール構造の契約 [境界]", () => {
    // spec: 0002-offline-cheer/spec.md / "プール構造の契約 [境界]"
    const fullPool = (): MessagePool => {
      const buckets = Object.fromEntries(
        ALL_BUCKET_KEYS.map((k, i) => [k, [{ id: `m${i}`, text: "テスト" }]]),
      ) as MessagePool["buckets"];
      return { characterId: "c1", version: 1, buckets };
    };

    it("accepts a pool that holds all 24 keys", () => {
      expect(isValidPool(fullPool())).toBe(true);
    });

    it("rejects a pool that is missing a key", () => {
      const pool = fullPool();
      delete (pool.buckets as Record<string, unknown>)["fast_regular_evening"];
      expect(isValidPool(pool)).toBe(false);
    });

    it("rejects a pool that has an unknown key", () => {
      const pool = fullPool();
      (pool.buckets as Record<string, unknown>)["weird_key"] = [{ id: "x", text: "x" }];
      expect(isValidPool(pool)).toBe(false);
    });

    it("rejects null / non-object input", () => {
      expect(isValidPool(null)).toBe(false);
      expect(isValidPool(undefined)).toBe(false);
      expect(isValidPool("pool")).toBe(false);
    });

    it("rejects when a bucket value is not an array of messages", () => {
      const pool = fullPool();
      (pool.buckets as Record<string, unknown>)["fast_regular_evening"] = "not-an-array";
      expect(isValidPool(pool)).toBe(false);
    });

    it("rejects when a message lacks id / text", () => {
      const pool = fullPool();
      (pool.buckets as Record<string, unknown>)["fast_regular_evening"] = [{ id: "ok" }];
      expect(isValidPool(pool)).toBe(false);
    });

    it("accepts empty buckets (生成失敗の欠損を許容、選択時にフォールバック)", () => {
      // empty bucket is a runtime concern handled by cheerSelector — pool is still structurally valid.
      const pool = fullPool();
      (pool.buckets as Record<string, unknown>)["fast_milestone_night"] = [];
      expect(isValidPool(pool)).toBe(true);
    });
  });

  describe("countMessages: 集計", () => {
    it("returns 0 for empty buckets across all 24 keys", () => {
      const buckets = Object.fromEntries(
        ALL_BUCKET_KEYS.map((k) => [k, [] as { id: string; text: string }[]]),
      ) as unknown as MessagePool["buckets"];
      expect(countMessages({ characterId: "c1", version: 1, buckets })).toBe(0);
    });

    it("sums message counts across buckets", () => {
      const buckets = Object.fromEntries(
        ALL_BUCKET_KEYS.map((k, i) => [
          k,
          Array.from({ length: i % 3 }, (_, j) => ({ id: `m${i}-${j}`, text: "x" })),
        ]),
      ) as MessagePool["buckets"];
      // 24 keys with sizes 0,1,2,0,1,2,... = 8 * (0+1+2) = 24
      expect(countMessages({ characterId: "c1", version: 1, buckets })).toBe(24);
    });
  });
});
