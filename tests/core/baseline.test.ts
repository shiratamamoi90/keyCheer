import { describe, it, expect } from "vitest";
import { baselineMessages } from "../../src/core/baseline/messages.js";
import { ALL_BUCKET_KEYS } from "../../src/core/messagePool.js";
import { selectCheer } from "../../src/core/cheerSelector.js";

// 要件: docs/cheer-trigger.md「キャラ未作成時の発動」/ docs/data-model.md「Baseline 定型文(同梱)」
// 同梱 baseline の契約: 全 24 シナリオキーに 1 件以上、各文 30 字以内、コード同梱。

describe("baseline / 同梱 baseline 定型文の契約", () => {
  it("covers all 24 bucket keys with at least one message each", () => {
    for (const key of ALL_BUCKET_KEYS) {
      const list = baselineMessages[key];
      expect(list, `bucket ${key} が存在する`).toBeDefined();
      expect(list.length, `bucket ${key} に 1 件以上`).toBeGreaterThanOrEqual(1);
    }
  });

  it("has no extra keys outside the 24 scenarios", () => {
    const known = new Set<string>(ALL_BUCKET_KEYS);
    for (const key of Object.keys(baselineMessages)) {
      expect(known.has(key), `未知のキー ${key}`).toBe(true);
    }
  });

  it("every message is a non-empty string within 30 characters", () => {
    // 1 文 = 30 文字以内(プール生成文と同一の契約)。{milestone} は補間後に伸び得るため
    // プレースホルダを 6 桁数値(100000)に置換した長さでも検査する。
    for (const key of ALL_BUCKET_KEYS) {
      for (const text of baselineMessages[key]) {
        expect(text.length, `${key}: "${text}" が空でない`).toBeGreaterThan(0);
        expect(text.length, `${key}: "${text}" は 30 字以内`).toBeLessThanOrEqual(30);
        const interpolated = text.replace(/\{milestone\}/g, "100000");
        expect(interpolated.length, `${key}: "${text}" は補間後も 30 字以内`).toBeLessThanOrEqual(
          30,
        );
      }
    }
  });
});

describe("baseline / キャラ未作成時の発動(統合)", () => {
  it("selectCheer with null pool returns a non-empty baseline message", () => {
    // GIVEN プール未生成(キャラ未作成)
    // WHEN トリガー条件を満たして選択する
    // THEN 同梱 baseline から空でない 1 文が返る(クラッシュしない・外部送信なし)
    const result = selectCheer({
      pool: null,
      zone: "normal",
      type: "regular",
      timeOfDay: "morning",
      lastMessageIdByBucket: {},
      baseline: baselineMessages,
      random: () => 0.5,
    });
    expect(result.source).toBe("baseline");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("milestone selection interpolates {milestone} into the displayed text", () => {
    const result = selectCheer({
      pool: null,
      zone: "fast",
      type: "milestone",
      timeOfDay: "night",
      milestone: 1000,
      lastMessageIdByBucket: {},
      baseline: baselineMessages,
      random: () => 0,
    });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).not.toContain("{milestone}");
  });
});
