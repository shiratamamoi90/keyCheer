// eval/imageProcessComparison: 画像の作り方の計測(論点 0045)の、決定的に計算する部分。
// 絵の良し悪しは縛らない(人間が見て判断する)。ここで縛るのは、背景を抜く処理・5 色に減らす処理・
// プロンプトの組み立て・集計・並べて見る頁。画像生成そのもの(子プロセス・コンテナ)は起こさない。

import { describe, it, expect } from "vitest";
import {
  applyPalette,
  buildAppearanceTagPrompt,
  buildIdleExtraArgs,
  buildProcessPage,
  buildProcessPrompt,
  computeBackgroundMatchPct,
  computeChangedRatioPct,
  computePalette,
  computeProcessSummary,
  computeTransparentRatioPct,
  countOpaqueColors,
  removeBackground,
  type ProcessRecord,
} from "../../src/eval/imageProcessComparison.js";
import type { RgbaImage } from "../../src/eval/png.js";

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [200, 0, 0];
const BLUE: Rgb = [0, 0, 200];

// 文字 1 つ = 1 画素の絵から画像を作る
function makeImage(rows: readonly string[], colors: Readonly<Record<string, Rgb>>): RgbaImage {
  const width = rows[0]!.length;
  const pixels = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const [r, g, b] = colors[ch]!;
      pixels.set([r, g, b, 255], (y * width + x) * 4);
    });
  });
  return { width, height: rows.length, pixels };
}

function alphaOf(image: RgbaImage): number[] {
  const alphas: number[] = [];
  for (let i = 3; i < image.pixels.length; i += 4) alphas.push(image.pixels[i]!);
  return alphas;
}

function makeRecord(overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    variant: "counterfeit-v3",
    character: "チア",
    kind: "idle",
    trial: 0,
    seed: 42,
    strength: null,
    prompt: "1girl, solo",
    latencyMs: 60000,
    peakMemoryMb: 3000,
    failed: false,
    rawFile: "counterfeit-v3/チア-idle-t0.raw.png",
    file: "counterfeit-v3/チア-idle-t0.png",
    transparentRatioPct: 50,
    colorCount: 5,
    changedFromIdlePct: null,
    backgroundMatchPct: 100,
    ...overrides,
  };
}

describe("removeBackground", () => {
  it("makes the background connected to the border transparent and keeps the character", () => {
    const image = makeImage(["wwww", "wrrw", "wrrw", "wwww"], { w: WHITE, r: RED });
    const cut = removeBackground(image, 30);
    expect(alphaOf(cut)).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
  });

  it("keeps a background-colored area that is enclosed by the character", () => {
    const image = makeImage(["wwwww", "wrrrw", "wrwrw", "wrrrw", "wwwww"], { w: WHITE, r: RED });
    const cut = removeBackground(image, 30);
    expect(alphaOf(cut)[12]).toBe(255);
  });

  it("treats colors within the tolerance as background", () => {
    const image = makeImage(["wwg", "wrg", "wwg"], { w: WHITE, g: [245, 245, 245], r: RED });
    const cut = removeBackground(image, 30);
    expect(alphaOf(cut)).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("removes only the given background color when it is fixed", () => {
    // 縁でいちばん多いのは赤だが、抜く色を白に固定しているので白だけが抜ける
    const image = makeImage(["rrr", "rrr", "wwr"], { w: WHITE, r: RED });
    const cut = removeBackground(image, 30, WHITE);
    expect(alphaOf(cut)).toEqual([255, 255, 255, 255, 255, 255, 0, 0, 255]);
  });

  it("removes nothing when the fixed background color is not on the border", () => {
    const image = makeImage(["rr", "rr"], { r: RED });
    const cut = removeBackground(image, 30, WHITE);
    expect(alphaOf(cut)).toEqual([255, 255, 255, 255]);
  });

  it("does not modify the input image", () => {
    const image = makeImage(["ww", "wr"], { w: WHITE, r: RED });
    const before = [...image.pixels];
    removeBackground(image, 30);
    expect([...image.pixels]).toEqual(before);
  });
});

describe("computePalette / applyPalette", () => {
  it("returns no more colors than the limit", () => {
    const image = makeImage(["abcdefgh"], {
      a: [0, 0, 0],
      b: [250, 0, 0],
      c: [0, 250, 0],
      d: [0, 0, 250],
      e: [250, 250, 0],
      f: [0, 250, 250],
      g: [250, 0, 250],
      h: [120, 120, 120],
    });
    expect(computePalette(image, 5)).toHaveLength(5);
  });

  it("keeps the colors as they are when the image has fewer colors than the limit", () => {
    const image = makeImage(["rrbb"], { r: RED, b: BLUE });
    const palette = computePalette(image, 5);
    expect([...palette].sort()).toEqual([BLUE, RED].map((c) => [...c]).sort());
  });

  it("does not count transparent pixels as a color", () => {
    const image = removeBackground(makeImage(["www", "wrw", "www"], { w: WHITE, r: RED }), 30);
    expect(computePalette(image, 5)).toEqual([[200, 0, 0]]);
  });

  it("paints every opaque pixel with the nearest palette color", () => {
    const image = makeImage(["ab"], { a: [210, 10, 10], b: [10, 10, 190] });
    const painted = applyPalette(image, [
      [200, 0, 0],
      [0, 0, 200],
    ]);
    expect([...painted.pixels]).toEqual([200, 0, 0, 255, 0, 0, 200, 255]);
  });

  it("leaves transparent pixels transparent", () => {
    const image = removeBackground(makeImage(["www", "wrw", "www"], { w: WHITE, r: RED }), 30);
    const painted = applyPalette(image, [[200, 0, 0]]);
    expect(alphaOf(painted)).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("limits another image to the same colors when given the same palette", () => {
    const idle = makeImage(["rrbb"], { r: RED, b: BLUE });
    const derived = makeImage(["abcd"], {
      a: [180, 20, 20],
      b: [220, 5, 5],
      c: [20, 20, 220],
      d: [90, 90, 90],
    });
    const painted = applyPalette(derived, computePalette(idle, 5));
    expect(countOpaqueColors(painted)).toBe(2);
  });
});

describe("指標", () => {
  it("computes the share of transparent pixels", () => {
    const image = removeBackground(makeImage(["wwww", "wrrw"], { w: WHITE, r: RED }), 30);
    expect(computeTransparentRatioPct(image)).toBe(75);
  });

  it("computes the share of border pixels that have the fixed background color", () => {
    // 3x3 の縁は 8 画素。白は 6 画素
    const image = makeImage(["www", "wrw", "wrr"], { w: WHITE, r: RED });
    expect(computeBackgroundMatchPct(image, WHITE, 30)).toBe(75);
  });

  it("computes the share of pixels that differ from the idle image", () => {
    const idle = makeImage(["rrrr"], { r: RED });
    const derived = makeImage(["rrbs"], { r: RED, b: BLUE, s: [205, 0, 0] });
    expect(computeChangedRatioPct(idle, derived, 30)).toBe(25);
  });

  it("summarizes failures, background failures and the color limit", () => {
    const summary = computeProcessSummary(
      "counterfeit-v3",
      [
        makeRecord(),
        makeRecord({ kind: "regular", transparentRatioPct: 0.5, changedFromIdlePct: 20 }),
        makeRecord({
          kind: "milestone",
          colorCount: 5,
          changedFromIdlePct: 40,
          backgroundMatchPct: 20,
        }),
        makeRecord({
          trial: 1,
          failed: true,
          file: null,
          rawFile: null,
          transparentRatioPct: null,
          colorCount: null,
          peakMemoryMb: null,
          backgroundMatchPct: null,
        }),
      ],
      { colorLimit: 5, minTransparentPct: 5, maxTransparentPct: 95, minBackgroundMatchPct: 50 },
    );
    expect(summary).toEqual({
      variant: "counterfeit-v3",
      images: 4,
      failedRatePct: 25,
      meanLatencyMs: 60000,
      maxLatencyMs: 60000,
      maxPeakMemoryMb: 3000,
      backgroundFailedCount: 1,
      backgroundMismatchCount: 1,
      overColorLimitCount: 0,
      meanChangedFromIdlePct: 30,
    });
  });
});

describe("プロンプト", () => {
  it("puts the fixed tags first, then the appearance, the pose and the LoRA", () => {
    const prompt = buildProcessPrompt({
      fixedTags: "solo, {background}",
      backgroundTag: "white background",
      appearanceTags: "1girl, long hair",
      poseTags: "smile",
      loraName: "lcm",
    });
    expect(prompt).toBe("solo, white background, 1girl, long hair, smile, <lora:lcm:1>");
  });

  it("leaves no empty tag when the background tag is empty", () => {
    const prompt = buildProcessPrompt({
      fixedTags: "solo, {background}, flat color",
      backgroundTag: "",
      appearanceTags: "1girl",
      poseTags: "",
      loraName: "lcm",
    });
    expect(prompt).toBe("solo, flat color, 1girl, <lora:lcm:1>");
  });

  it("passes the canvas, the strength and the steps for the idle image", () => {
    expect(
      buildIdleExtraArgs({ steps: 4, idleSteps: 8, idleStrength: 0.9 }, "/out/canvas.png"),
    ).toEqual(["--steps", "8", "--init-img", "/out/canvas.png", "--strength", "0.9"]);
  });

  it("passes nothing extra for the idle image when it is made as before", () => {
    expect(buildIdleExtraArgs({ steps: 4, idleSteps: 4, idleStrength: 0.9 }, null)).toEqual([]);
  });

  it("adds a person tag when the appearance tags have none", () => {
    const prompt = buildProcessPrompt({
      fixedTags: "solo",
      backgroundTag: "white background",
      appearanceTags: "long hair",
      poseTags: "",
      loraName: "lcm",
    });
    expect(prompt).toBe("solo, 1girl, long hair, <lora:lcm:1>");
  });

  it("asks for the appearance without any cheer message", () => {
    const prompt = buildAppearanceTagPrompt({ name: "チア", personality: "元気" });
    expect(prompt).toContain("キャラクター: チア");
    expect(prompt).not.toContain("セリフ");
  });
});

describe("buildProcessPage", () => {
  it("escapes the prompt so that tags from the model cannot inject markup", () => {
    const page = buildProcessPage({
      models: ["counterfeit-v3"],
      records: [makeRecord({ prompt: "<script>alert(1)</script>" })],
      baselineFiles: {},
    });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;");
  });

  it("puts the baseline image, the raw image and the processed image of a case in one row", () => {
    const page = buildProcessPage({
      models: ["counterfeit-v3"],
      records: [makeRecord()],
      baselineFiles: { "counterfeit-v3/チア/idle/0": "baseline/counterfeit-v3/a.png" },
    });
    const row = page.split("\n").find((line) => line.includes('class="case"'))!;
    expect(row).toContain("baseline/counterfeit-v3/a.png");
    expect(row).toContain("idle-t0.raw.png");
    expect(row).toContain("idle-t0.png");
  });
});
