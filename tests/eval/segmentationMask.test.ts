// eval/segmentationMask: 人物を切り抜くモデル(u2netp)で背景を透明にする計測(論点 0063)の、決定的に計算する部分。
// モデルの推論そのものと切り抜きの良し悪しは縛らない。ここで縛るのは入力の作り方・確率の拡大縮小・透明にする判定。

import { describe, expect, it } from "vitest";
import {
  applyProbabilityMask,
  buildU2netInput,
  computeNormalizedProbability,
  resizeProbabilityMap,
} from "../../src/eval/segmentationMask.js";
import type { RgbaImage } from "../../src/eval/png.js";

function solid(width: number, height: number, rgb: readonly number[]): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([...rgb, 255], i * 4);
  return { width, height, pixels };
}

describe("segmentationMask / モデルへの入力", () => {
  it("scales by the brightest value and normalizes each channel in channel-first order", () => {
    const input = buildU2netInput(solid(4, 2, [255, 255, 255]), 2);
    expect(input.length).toBe(3 * 2 * 2);
    // (1 - 平均) / 標準偏差。R・G・B の順に 4 画素ずつ
    expect(input[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(input[4]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(input[8]).toBeCloseTo((1 - 0.406) / 0.225, 5);
  });
});

describe("segmentationMask / 確率の扱い", () => {
  it("stretches the probabilities to 0..1", () => {
    expect([...computeNormalizedProbability(Float32Array.from([2, 4, 6]))]).toEqual([0, 0.5, 1]);
    expect([...computeNormalizedProbability(Float32Array.from([3, 3]))]).toEqual([0, 0]);
  });

  it("resizes the map bilinearly and keeps the corners", () => {
    const resized = resizeProbabilityMap(Float32Array.from([0, 1, 0, 1]), 2, 2, 3, 1);
    expect([...resized]).toEqual([0, 0.5, 1]);
  });

  it("makes the pixels below the threshold transparent and the rest fully opaque", () => {
    const image = solid(3, 1, [10, 20, 30]);
    image.pixels[3] = 100;
    const cut = applyProbabilityMask(image, Float32Array.from([0.2, 0.5, 0.9]), 0.5);
    expect([...cut.pixels]).toEqual([0, 0, 0, 0, 10, 20, 30, 255, 10, 20, 30, 255]);
    expect(image.pixels[3]).toBe(100);
  });
});
