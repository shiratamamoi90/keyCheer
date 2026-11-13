// eval/imageModelComparison: 画像のベースモデルの計測(論点 0041)の、記録から決定的に計算する部分。
// 絵の良し悪しは縛らない(人間が見て判断する)。ここで縛るのは集計と、並べて見る頁の組み立てだけ。
// 画像生成そのもの(子プロセス・コンテナ)は起こさない。

import { describe, it, expect } from "vitest";
import {
  buildComparisonPage,
  buildSdcppExtraArgs,
  computeImageSummary,
  type ImageRecord,
} from "../../src/eval/imageModelComparison.js";

function makeRecord(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    variant: "counterfeit-v3",
    character: "チア",
    kind: "idle",
    trial: 0,
    seed: 42,
    prompt: "smile, standing",
    latencyMs: 60000,
    peakMemoryMb: 3000,
    failed: false,
    file: "counterfeit-v3/チア-idle-t0.png",
    ...overrides,
  };
}

describe("computeImageSummary", () => {
  it("counts images and computes the failed rate to one decimal place", () => {
    const records = [
      makeRecord(),
      makeRecord({ kind: "regular" }),
      makeRecord({ kind: "milestone", failed: true, file: null, peakMemoryMb: null }),
    ];
    const summary = computeImageSummary("counterfeit-v3", records);
    expect(summary.images).toBe(3);
    expect(summary.failedRatePct).toBe(33.3);
  });

  it("computes mean and max latency from succeeded images only", () => {
    const records = [
      makeRecord({ latencyMs: 40000 }),
      makeRecord({ latencyMs: 80000 }),
      // タイムアウトで失敗した 1 枚の時間は上限値そのものなので、平均に混ぜない
      makeRecord({ latencyMs: 600000, failed: true, file: null, peakMemoryMb: null }),
    ];
    const summary = computeImageSummary("counterfeit-v3", records);
    expect(summary.meanLatencyMs).toBe(60000);
    expect(summary.maxLatencyMs).toBe(80000);
  });

  it("reports the largest peak memory and ignores images where it was not measured", () => {
    const records = [
      makeRecord({ peakMemoryMb: 2800 }),
      makeRecord({ peakMemoryMb: null }),
      makeRecord({ peakMemoryMb: 3400 }),
    ];
    expect(computeImageSummary("counterfeit-v3", records).maxPeakMemoryMb).toBe(3400);
  });

  it("returns zeros and null memory when there are no records", () => {
    expect(computeImageSummary("meinamix-v10", [])).toEqual({
      variant: "meinamix-v10",
      images: 0,
      failedRatePct: 0,
      meanLatencyMs: 0,
      maxLatencyMs: 0,
      maxPeakMemoryMb: null,
    });
  });

  it("does not modify the records", () => {
    const records = [makeRecord(), makeRecord({ failed: true, file: null })];
    const before = JSON.stringify(records);
    computeImageSummary("counterfeit-v3", records);
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe("buildSdcppExtraArgs", () => {
  it("passes the sampling method and the guidance scale as separate arguments", () => {
    expect(buildSdcppExtraArgs({ samplingMethod: "lcm", cfgScale: 1 })).toEqual([
      "--sampling-method",
      "lcm",
      "--cfg-scale",
      "1",
    ]);
  });
});

describe("buildComparisonPage", () => {
  it("puts the same case of each variant side by side in one row", () => {
    const html = buildComparisonPage(
      ["counterfeit-v3", "meinamix-v10"],
      [
        makeRecord(),
        makeRecord({ variant: "meinamix-v10", file: "meinamix-v10/チア-idle-t0.png" }),
      ],
    );
    expect(html.match(/<tr class="case">/g)).toHaveLength(1);
    expect(html).toContain('src="counterfeit-v3/%E3%83%81%E3%82%A2-idle-t0.png"');
    expect(html).toContain('src="meinamix-v10/%E3%83%81%E3%82%A2-idle-t0.png"');
  });

  it("shows a failure mark instead of an image when the image failed", () => {
    const html = buildComparisonPage(
      ["counterfeit-v3"],
      [makeRecord({ failed: true, file: null, error: "sd.cpp exited with code 1" })],
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("失敗");
  });

  it("escapes the prompt so that tags from the model cannot inject markup", () => {
    const html = buildComparisonPage(
      ["counterfeit-v3"],
      [makeRecord({ prompt: '<script>alert("x")</script>' })],
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
