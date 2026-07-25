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

  describe("選択元バケット(sourceBucketKey)", () => {
    // spec: changes/0006-cheer-selection-source-bucket/spec.md

    it("直接ヒット時は source = target: sourceBucketKey === bucketKey", () => {
      const pool = makePool(() => [{ id: "a", text: "alpha" }]);
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.source).toBe("pool");
      expect(result.bucketKey).toBe("fast_regular_evening");
      expect(result.sourceBucketKey).toBe("fast_regular_evening");
    });

    it("ゾーンフォールバック時の選択元: sourceBucketKey は実際に選んだバケット", () => {
      const pool = makePool((k) =>
        k === bucketKey("normal", "regular", "evening") ? [{ id: "fb", text: "fb" }] : [],
      );
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.source).toBe("fallback-zone");
      expect(result.bucketKey).toBe("fast_regular_evening"); // 照会キーは不変(後方互換)
      expect(result.sourceBucketKey).toBe("normal_regular_evening");
    });

    it("type フォールバック時の選択元: 別 timeOfDay のバケットが選択元になる", () => {
      const pool = makePool((k) =>
        k === bucketKey("slow", "regular", "morning") ? [{ id: "fb2", text: "fb2" }] : [],
      );
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.source).toBe("fallback-type");
      expect(result.sourceBucketKey).toBe("slow_regular_morning");
    });

    it("フォールバック先での連続回避: 除外の参照は選択元バケット基準", () => {
      // GIVEN ターゲット (fast, regular, evening) が空、(normal, regular, evening) に m1, m2
      const pool = makePool((k) =>
        k === bucketKey("normal", "regular", "evening")
          ? [
              { id: "m1", text: "one" },
              { id: "m2", text: "two" },
            ]
          : [],
      );
      // 呼び出し側は前回の結果を sourceBucketKey に記録している(記録契約)
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: { normal_regular_evening: "m1" },
        baseline: makeBaseline("BASE"),
        random: () => 0, // 除外がなければ m1 を選ぶはず
      });
      expect(result.messageId).toBe("m2");
      expect(result.sourceBucketKey).toBe("normal_regular_evening");
    });

    it("baseline 選択時の選択元: 実際に参照した baseline キーを返す", () => {
      const result = selectCheer({
        pool: null,
        zone: "normal",
        type: "regular",
        timeOfDay: "morning",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.source).toBe("baseline");
      expect(result.sourceBucketKey).toBe("normal_regular_morning");
    });

    it("記録契約: sourceBucketKey に記録して次回選択すると直前の文が除外される", () => {
      const pool = makePool((k) =>
        k === bucketKey("normal", "regular", "evening")
          ? [
              { id: "m1", text: "one" },
              { id: "m2", text: "two" },
            ]
          : [],
      );
      const args = {
        pool,
        zone: "fast" as const,
        type: "regular" as const,
        timeOfDay: "evening" as const,
        baseline: makeBaseline("BASE"),
        random: () => 0,
      };
      const first = selectCheer({ ...args, lastMessageIdByBucket: {} });
      // 呼び出し側の契約: lastMessageIdByBucket[result.sourceBucketKey] = result.messageId
      const second = selectCheer({
        ...args,
        lastMessageIdByBucket: { [first.sourceBucketKey]: first.messageId },
      });
      expect(second.messageId).not.toBe(first.messageId);
    });

    it("既存フィールドの後方互換: bucketKey / messageId / text / source の意味は不変", () => {
      const pool = makePool((k) =>
        k === bucketKey("normal", "regular", "evening") ? [{ id: "fb", text: "fb-text" }] : [],
      );
      const result = selectCheer({
        pool,
        zone: "fast",
        type: "regular",
        timeOfDay: "evening",
        lastMessageIdByBucket: {},
        baseline: makeBaseline("BASE"),
        random: () => 0,
      });
      expect(result.bucketKey).toBe("fast_regular_evening");
      expect(result.messageId).toBe("fb");
      expect(result.text).toBe("fb-text");
      expect(result.source).toBe("fallback-zone");
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
