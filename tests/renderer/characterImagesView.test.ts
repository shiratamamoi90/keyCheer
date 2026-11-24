// renderer/characterImagesView: 作った画像 3 枚の並べ方と、「画像だけ作り直す」を使えるか(純粋関数)。
// 要件: docs/main-window.md(論点 0050)

import { describe, expect, it } from "vitest";
import {
  buildImageSlots,
  canShowGeneratedImages,
  resolveImageRegeneration,
} from "../../src/renderer/characterImagesView.js";
import { applyGenerationEvent, initialGenerationState } from "../../src/renderer/generationView.js";

const PATHS = {
  idle: "/u/characters/c/images/idle.png",
  regular: "/u/characters/c/images/regular.png",
  milestone: "/u/characters/c/images/milestone.png",
};

describe("characterImagesView / 切り替え画面で選んだキャラクターの 3 枚を大きく出す", () => {
  it("S0050_01 lists the idle, regular and milestone images with their labels and media URLs", () => {
    expect(buildImageSlots(PATHS)).toEqual([
      {
        kind: "idle",
        label: "ふだん",
        url: `keycheer-audio://image/${encodeURIComponent(PATHS.idle)}`,
      },
      {
        kind: "regular",
        label: "通常の応援",
        url: `keycheer-audio://image/${encodeURIComponent(PATHS.regular)}`,
      },
      {
        kind: "milestone",
        label: "節目の応援",
        url: `keycheer-audio://image/${encodeURIComponent(PATHS.milestone)}`,
      },
    ]);
  });
});

describe("characterImagesView / 生成の進捗と結果を入力の枠の下に出す", () => {
  it("S0061_05 shows the generated images once the generation is done and not while it runs", () => {
    const running = applyGenerationEvent(initialGenerationState(), {
      type: "progress",
      phase: "image",
      done: 1,
      total: 3,
    });
    expect(canShowGeneratedImages(initialGenerationState())).toBe(false);
    expect(canShowGeneratedImages(running)).toBe(false);
    expect(
      canShowGeneratedImages(
        applyGenerationEvent(running, { type: "done", synthesized: 48, missing: 0 }),
      ),
    ).toBe(true);
  });
});

describe("characterImagesView / 欠けた画像は欠けていると分かるように示す [境界]", () => {
  it("S0050_03 leaves the missing image empty instead of using the idle image", () => {
    const slots = buildImageSlots({ idle: PATHS.idle, milestone: PATHS.milestone });
    expect(slots[1]).toEqual({ kind: "regular", label: "通常の応援", url: null });
    expect(slots[0]!.url).not.toBeNull();
  });
});

describe("characterImagesView / 3 枚を出している所に「画像だけ作り直す」を出す", () => {
  it("S0050_06 enables the image-only regeneration when the weights exist and nothing runs", () => {
    expect(resolveImageRegeneration({ canMakeImages: true, isRunning: false })).toEqual({
      isEnabled: true,
      notice: null,
    });
  });
});

describe("characterImagesView / 画像の重みが無いか、生成中なら画像だけ作り直せない [境界]", () => {
  it("S0050_07 disables it and says why", () => {
    expect(resolveImageRegeneration({ canMakeImages: false, isRunning: false })).toEqual({
      isEnabled: false,
      notice: "画像生成のモデルの重みがありません。インストーラで入れ直してください",
    });
    expect(resolveImageRegeneration({ canMakeImages: true, isRunning: true })).toEqual({
      isEnabled: false,
      notice: "生成中です。終わってから作り直せます",
    });
  });
});
