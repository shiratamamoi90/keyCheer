// eval/postProcessComparison: 描いた絵の後処理だけを振る計測(論点 0063 背景の抜き方 / 0064 色の数)と、
// 崩れの目安(論点 0065)の、決定的に計算する部分。絵の良し悪しは縛らない(人間が見て判断する)。

import { describe, expect, it } from "vitest";
import {
  applyTwoPassBackgroundRemoval,
  buildPostProcessPage,
  computeAlphaChangedPct,
  computeMeanColorError,
  computeOpaqueBlobCount,
  downscaleImage,
  hasSkinColor,
  isBackgroundVariant,
} from "../../src/eval/postProcessComparison.js";
import type { RgbaImage } from "../../src/eval/png.js";

// 1 文字 = 1 画素。文字ごとの色(. は透明)
const COLORS: Record<string, readonly number[]> = {
  w: [255, 255, 255, 255],
  b: [230, 220, 190, 255], // 地の色(白から色の差 48 より遠い)
  k: [20, 20, 20, 255],
  r: [200, 40, 40, 255],
  ".": [0, 0, 0, 0],
};

function image(rows: readonly string[]): RgbaImage {
  const width = rows[0]!.length;
  const pixels = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => [...row].forEach((c, x) => pixels.set(COLORS[c]!, (y * width + x) * 4)));
  return { width, height: rows.length, pixels };
}

function alphaRows(img: RgbaImage): string[] {
  const rows: string[] = [];
  for (let y = 0; y < img.height; y++) {
    let row = "";
    for (let x = 0; x < img.width; x++)
      row += img.pixels[(y * img.width + x) * 4 + 3] === 0 ? "." : "#";
    rows.push(row);
  }
  return rows;
}

describe("postProcessComparison / 背景の抜き方", () => {
  // 白い外枠の内側に地(b)があり、その中に人物(k・r)がいる
  const framed = image([
    "wwwwwww",
    "wbbbbbw",
    "wbkkkbw",
    "wbkrkbw",
    "wbkkkbw",
    "wbbbbbw",
    "wwwwwww",
  ]);

  it("removes the ground inside the frame on the second pass", () => {
    const cut = applyTwoPassBackgroundRemoval(framed, 48);
    expect(alphaRows(cut)).toEqual([
      ".......",
      ".......",
      "..###..",
      "..###..",
      "..###..",
      ".......",
      ".......",
    ]);
  });

  it("keeps the input unchanged", () => {
    const before = Uint8Array.from(framed.pixels);
    applyTwoPassBackgroundRemoval(framed, 48);
    expect([...framed.pixels]).toEqual([...before]);
  });

  it("accepts only the three variant names", () => {
    expect(["single", "two-pass", "wide-tolerance"].every(isBackgroundVariant)).toBe(true);
    expect(isBackgroundVariant("rembg")).toBe(false);
  });
});

describe("postProcessComparison / 縮小", () => {
  it("averages each block of pixels and keeps transparent pixels out of the color", () => {
    const small = downscaleImage(image(["wk", "..", "rr", "rr"]), 1, 2);
    expect(small.width).toBe(1);
    expect(small.height).toBe(2);
    // 上の 2x2:不透明は w と k の 2 つ → 色はその平均、アルファは 4 画素の平均
    expect([...small.pixels.slice(0, 4)]).toEqual([138, 138, 138, 128]);
    expect([...small.pixels.slice(4, 8)]).toEqual([200, 40, 40, 255]);
  });
});

describe("postProcessComparison / 指標", () => {
  it("measures the share of pixels whose transparency changed", () => {
    expect(computeAlphaChangedPct(image(["w.", "ww"]), image(["..", "ww"]))).toBe(25);
    expect(() => computeAlphaChangedPct(image(["w"]), image(["ww"]))).toThrow();
  });

  it("averages the color distance over the opaque pixels", () => {
    expect(computeMeanColorError(image(["kw."]), image(["kk."]))).toBe(203.5);
    expect(computeMeanColorError(image([".."]), image([".."]))).toBeNull();
  });

  it("finds a skin color only among warm and light colors", () => {
    expect(hasSkinColor([[240, 200, 180]])).toBe(true);
    expect(
      hasSkinColor([
        [200, 230, 120],
        [120, 140, 200],
        [250, 250, 250],
      ]),
    ).toBe(false);
  });

  it("counts the opaque pieces that are large enough", () => {
    const pieces = image(["kk..k", "kk...", ".....", "..rr."]);
    expect(computeOpaqueBlobCount(pieces, 2)).toBe(2);
    expect(computeOpaqueBlobCount(pieces, 1)).toBe(3);
  });
});

describe("postProcessComparison / 並べて見る頁", () => {
  it("escapes the names it shows", () => {
    const page = buildPostProcessPage({
      title: "<b>x</b>",
      variants: ["single"],
      rows: [{ label: '<script>alert("x")</script>', files: { single: ["a.png"] } }],
    });
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;");
  });
});
