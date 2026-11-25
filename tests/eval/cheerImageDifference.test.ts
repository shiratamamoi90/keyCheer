// eval/cheerImageDifference: 通常と節目の絵の違いの計測(論点 0062)の、決定的に計算する部分。
// 絵の良し悪しは縛らない(人間が見て判断する)。ここで縛るのは、案ごとの画像タグの組み立て・外形の重なり・集計・頁の安全。

import { describe, expect, it } from "vitest";
import {
  buildCheerPoseTags,
  buildExpressionTagPrompt,
  buildVariantCases,
  computeCheerDifferenceSummary,
  computeMaskOverlapPct,
  isCheerImageVariant,
  type CheerTagCase,
} from "../../src/eval/cheerImageDifference.js";
import type { RgbaImage } from "../../src/eval/png.js";
import { ALL_BUCKET_KEYS, computeCheerType, type MessagePool } from "../../src/core/messagePool.js";

const SETTINGS = {
  regularPoseTags: "fist pump, pointing at viewer",
  milestonePoseTags: "arms up, jumping",
  milestoneEffectTags: "sparkle, confetti",
};

function pool(): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((key) => [
      key,
      [{ text: computeCheerType(key) === "milestone" ? "節目だよ!" : "がんばれ!" }],
    ]),
  );
  return { buckets } as unknown as MessagePool;
}

// 不透明(#)と透明(.)で外形だけを持つ画像
function mask(rows: readonly string[]): RgbaImage {
  const width = rows[0]!.length;
  const pixels = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => pixels.set([0, 0, 0, c === "#" ? 255 : 0], (y * width + x) * 4)),
  );
  return { width, height: rows.length, pixels };
}

describe("cheerImageDifference / 案ごとの表情・ポーズの画像タグ", () => {
  it("keeps the model's own pose tags for the baseline", () => {
    const tags = buildCheerPoseTags({
      variant: "model-pose",
      kind: "milestone",
      modelPoseTags: "smile, peace sign",
      expressionTags: "grin",
      settings: SETTINGS,
    });
    expect(tags).toBe("smile, peace sign");
  });

  it("puts the expression first and adds the fixed pose of the kind", () => {
    expect(
      buildCheerPoseTags({
        variant: "fixed-pose",
        kind: "regular",
        modelPoseTags: "x",
        expressionTags: "smile",
        settings: SETTINGS,
      }),
    ).toBe("smile, fist pump, pointing at viewer");
    expect(
      buildCheerPoseTags({
        variant: "fixed-pose",
        kind: "milestone",
        modelPoseTags: "x",
        expressionTags: "smile",
        settings: SETTINGS,
      }),
    ).toBe("smile, arms up, jumping");
  });

  it("adds the effects to the milestone image only", () => {
    const build = (kind: "regular" | "milestone") =>
      buildCheerPoseTags({
        variant: "fixed-pose-effects",
        kind,
        modelPoseTags: "x",
        expressionTags: "smile",
        settings: SETTINGS,
      });
    expect(build("milestone")).toBe("smile, arms up, jumping, sparkle, confetti");
    expect(build("regular")).toBe("smile, fist pump, pointing at viewer");
  });

  it("asks only for the expression and passes only the lines of that kind", () => {
    const prompt = buildExpressionTagPrompt(
      { name: "チア", personality: "元気" },
      "milestone",
      pool(),
    );
    expect(prompt).toContain("表情だけ");
    expect(prompt).toContain("ポーズ・髪・目・服は書かないでください");
    expect(prompt).toContain("節目だよ!");
    expect(prompt).not.toContain("がんばれ!");
  });

  it("accepts only the three variant names", () => {
    expect(["model-pose", "fixed-pose", "fixed-pose-effects"].every(isCheerImageVariant)).toBe(
      true,
    );
    expect(isCheerImageVariant("arms-up")).toBe(false);
  });
});

describe("cheerImageDifference / 案ごとのケース", () => {
  const tagCase: CheerTagCase = {
    character: "チア",
    trial: 0,
    seed: 42,
    appearanceTags: "pink hair, school uniform",
    modelPoseTags: { regular: "smile, wave", milestone: "smile, arms up" },
    expressionTags: { regular: "smile" },
  };

  it("uses the same idle prompt in every variant and skips a kind whose tags are missing", () => {
    const build = (variant: "model-pose" | "fixed-pose") =>
      buildVariantCases({
        variant,
        tagCases: [tagCase],
        fixedTags: "solo, upper body",
        loraName: "lcm",
        settings: SETTINGS,
      })[0]!;
    const baseline = build("model-pose");
    const fixed = build("fixed-pose");

    expect(fixed.idlePrompt).toBe(baseline.idlePrompt);
    expect(baseline.idlePrompt).toBe(
      "solo, upper body, 1girl, pink hair, school uniform, <lora:lcm:1>",
    );
    expect(Object.keys(baseline.derivedPrompts).sort()).toEqual(["milestone", "regular"]);
    expect(Object.keys(fixed.derivedPrompts)).toEqual(["regular"]);
    expect(fixed.derivedPrompts.regular).toBe(
      "solo, upper body, 1girl, pink hair, school uniform, smile, fist pump, pointing at viewer, <lora:lcm:1>",
    );
  });
});

describe("cheerImageDifference / 外形の重なりと集計", () => {
  it("measures the overlap of the opaque shapes", () => {
    const a = mask(["##..", "##..", "...."]);
    expect(computeMaskOverlapPct(a, a)).toBe(100);
    expect(computeMaskOverlapPct(a, mask(["..##", "..##", "...."]))).toBe(0);
    expect(computeMaskOverlapPct(a, mask(["#...", "#...", "...."]))).toBe(50);
    expect(computeMaskOverlapPct(mask(["...."]), mask(["...."]))).toBeNull();
    expect(() => computeMaskOverlapPct(a, mask(["#"]))).toThrow();
  });

  it("averages the pairs of the variant and ignores pairs it could not measure", () => {
    const summary = computeCheerDifferenceSummary("fixed-pose", [
      { variant: "fixed-pose", character: "a", trial: 0, changedPct: 20, maskOverlapPct: 80 },
      { variant: "fixed-pose", character: "a", trial: 1, changedPct: 30, maskOverlapPct: null },
      { variant: "fixed-pose", character: "b", trial: 0, changedPct: null, maskOverlapPct: null },
      { variant: "model-pose", character: "a", trial: 0, changedPct: 90, maskOverlapPct: 10 },
    ]);
    expect(summary).toEqual({
      variant: "fixed-pose",
      pairCount: 2,
      meanChangedPct: 25,
      meanMaskOverlapPct: 80,
    });
  });
});
