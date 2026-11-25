// 描いた絵の後処理だけを振る計測(論点 0063 背景の抜き方 / 論点 0064 色の数)と、崩れの目安(論点 0065)。
// 絵は描き直さない:論点 0062 の計測で sd.cpp が出した縮小前の絵を読み、アプリと同じ順(縮小 → 背景を透明に → 減色)で
// 後処理だけを変えて並べる。後処理そのものはアプリの core(src/core/characterImage.ts)を呼ぶ。
//
// 縮小はアプリでは Electron の nativeImage がする。ここでは画素の平均で縮小する(Electron を計測に持ち込まないため)。
// そのため抜け方・色はアプリと少し違いうる。案どうしの比べ方は同じ縮小の上なので崩れない。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  applyBackgroundRemoval,
  applyImagePalette,
  computeImagePalette,
  type ImageColor,
} from "../core/characterImage.js";
import { computeTransparentRatioPct } from "./imageProcessComparison.js";
import { decodePng, encodePng, type RgbaImage } from "./png.js";

const RGBA_BYTES = 4;
const OPAQUE = 255;
const MIN_OPAQUE_ALPHA = 128;

export const BACKGROUND_VARIANTS = [
  "single",
  "two-pass",
  "wide-tolerance",
  "segment-u2netp",
] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

export function isBackgroundVariant(value: string): value is BackgroundVariant {
  return (BACKGROUND_VARIANTS as readonly string[]).includes(value);
}

function isOpaque(image: RgbaImage, index: number): boolean {
  return image.pixels[index * RGBA_BYTES + 3]! >= MIN_OPAQUE_ALPHA;
}

function colorDistance(a: Uint8Array, aOffset: number, b: readonly number[]): number {
  const dr = a[aOffset]! - b[0]!;
  const dg = a[aOffset + 1]! - b[1]!;
  const db = a[aOffset + 2]! - b[2]!;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function listNeighbors(index: number, width: number, height: number): number[] {
  const x = index % width;
  const neighbors: number[] = [];
  if (x > 0) neighbors.push(index - 1);
  if (x < width - 1) neighbors.push(index + 1);
  if (index >= width) neighbors.push(index - width);
  if (index < width * (height - 1)) neighbors.push(index + width);
  return neighbors;
}

// 案B1:1 段目(アプリと同じ抜き方)のあと、抜いた所に接する画素でいちばん多い色を、その画素からつながる所だけもう一度抜く。
// 絵の縁に細い枠があり、その内側に紙のような地が残る絵(論点 0062 の result.md)を狙う
export function applyTwoPassBackgroundRemoval(image: RgbaImage, tolerance: number): RgbaImage {
  const first = applyBackgroundRemoval(image, tolerance);
  const { width, height } = first;
  const pixels = Uint8Array.from(first.pixels);
  const total = width * height;

  const edge: number[] = [];
  const counts = new Map<number, { count: number; color: number[] }>();
  for (let index = 0; index < total; index++) {
    if (!isOpaque(first, index)) continue;
    if (!listNeighbors(index, width, height).some((n) => !isOpaque(first, n))) continue;
    edge.push(index);
    const offset = index * RGBA_BYTES;
    const color = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
    const key = (color[0]! << 16) | (color[1]! << 8) | color[2]!;
    const entry = counts.get(key) ?? { count: 0, color };
    entry.count += 1;
    counts.set(key, entry);
  }
  let ground: number[] | null = null;
  let best = 0;
  for (const [, entry] of [...counts.entries()].sort(([a], [b]) => a - b)) {
    if (entry.count > best) {
      best = entry.count;
      ground = entry.color;
    }
  }
  if (ground === null) return { width, height, pixels };

  const isGround = (index: number): boolean =>
    pixels[index * RGBA_BYTES + 3] === OPAQUE &&
    colorDistance(pixels, index * RGBA_BYTES, ground) <= tolerance;
  const visited = new Uint8Array(total);
  const queue = edge.filter((index) => isGround(index));
  for (const index of queue) visited[index] = 1;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    for (const n of listNeighbors(index, width, height)) {
      if (visited[n] === 0 && isGround(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  for (const index of queue) pixels.fill(0, index * RGBA_BYTES, (index + 1) * RGBA_BYTES);
  return { width, height, pixels };
}

// 画素の平均で縮小する(アルファで重みを付けた色・アルファの平均)。幅・高さは割り切れる倍率だけを受ける
export function downscaleImage(image: RgbaImage, width: number, height: number): RgbaImage {
  const fx = image.width / width;
  const fy = image.height / height;
  if (!Number.isInteger(fx) || !Number.isInteger(fy)) {
    throw new Error(`縮小の倍率が整数でない: ${image.width}x${image.height} → ${width}x${height}`);
  }
  const pixels = new Uint8Array(width * height * RGBA_BYTES);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < fy; dy++) {
        for (let dx = 0; dx < fx; dx++) {
          const offset = ((y * fy + dy) * image.width + x * fx + dx) * RGBA_BYTES;
          const alpha = image.pixels[offset + 3]!;
          r += image.pixels[offset]! * alpha;
          g += image.pixels[offset + 1]! * alpha;
          b += image.pixels[offset + 2]! * alpha;
          a += alpha;
        }
      }
      const out = (y * width + x) * RGBA_BYTES;
      if (a > 0) pixels.set([Math.round(r / a), Math.round(g / a), Math.round(b / a)], out);
      pixels[out + 3] = Math.round(a / (fx * fy));
    }
  }
  return { width, height, pixels };
}

function assertSameSize(a: RgbaImage, b: RgbaImage): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`大きさが違う: ${a.width}x${a.height} と ${b.width}x${b.height}`);
  }
}

// 透明かどうかが変わった画素の割合(%)。案どうしで、どれだけ抜け方が違うかの目安
export function computeAlphaChangedPct(a: RgbaImage, b: RgbaImage): number {
  assertSameSize(a, b);
  const total = a.width * a.height;
  let changed = 0;
  for (let index = 0; index < total; index++) {
    if (isOpaque(a, index) !== isOpaque(b, index)) changed += 1;
  }
  return Math.round((changed / total) * 1000) / 10;
}

// 減色の前と後で、不透明の画素の色がどれだけ離れたか(色の差の平均)。元の絵の色をどれだけ残せたかの目安
export function computeMeanColorError(before: RgbaImage, after: RgbaImage): number | null {
  assertSameSize(before, after);
  let sum = 0;
  let count = 0;
  for (let index = 0; index < before.width * before.height; index++) {
    if (!isOpaque(before, index) || !isOpaque(after, index)) continue;
    const offset = index * RGBA_BYTES;
    sum += colorDistance(before.pixels, offset, [
      after.pixels[offset]!,
      after.pixels[offset + 1]!,
      after.pixels[offset + 2]!,
    ]);
    count += 1;
  }
  return count === 0 ? null : Math.round((sum / count) * 10) / 10;
}

// 肌に近い色(赤みが強く、明るい暖色)がパレットにあるか。肌が髪や服の色に吸われたかの目安(論点 0064)
const MIN_SKIN_RED = 150;
const MIN_SKIN_RED_BLUE_GAP = 30;
export function hasSkinColor(palette: readonly (readonly number[])[]): boolean {
  return palette.some(
    ([r, g, b]) => r! >= MIN_SKIN_RED && r! > g! && g! > b! && r! - b! >= MIN_SKIN_RED_BLUE_GAP,
  );
}

// 色相の偏り:不透明で色味のある画素を色相 30 度ごとに分け、いちばん多い区間が占める割合(%)。
// 絵全体が 1 色に寄っているかの目安(論点 0067)。白・灰・黒に近い画素は色相が定まらないので数えない
const HUE_BIN_COUNT = 12;
const MIN_HUE_SATURATION = 0.2;
const MIN_HUE_VALUE = 0.15;
export function computeDominantHueSharePct(image: RgbaImage): number | null {
  const bins = new Array<number>(HUE_BIN_COUNT).fill(0);
  let counted = 0;
  for (let index = 0; index < image.width * image.height; index++) {
    if (!isOpaque(image, index)) continue;
    const offset = index * RGBA_BYTES;
    const r = image.pixels[offset]! / 255;
    const g = image.pixels[offset + 1]! / 255;
    const b = image.pixels[offset + 2]! / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (max < MIN_HUE_VALUE || delta / max < MIN_HUE_SATURATION) continue;
    const hue =
      max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    bins[Math.min(HUE_BIN_COUNT - 1, Math.floor((hue / 6) * HUE_BIN_COUNT))]! += 1;
    counted += 1;
  }
  if (counted === 0) return null;
  return Math.round((Math.max(...bins) / counted) * 1000) / 10;
}

// 上下左右でつながる不透明の塊のうち、minPixels 以上のものの数。人物が細切れになると増える(論点 0065)
export function computeOpaqueBlobCount(image: RgbaImage, minPixels: number): number {
  const { width, height } = image;
  const visited = new Uint8Array(width * height);
  let blobs = 0;
  for (let start = 0; start < width * height; start++) {
    if (visited[start] === 1 || !isOpaque(image, start)) continue;
    visited[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      for (const n of listNeighbors(queue[head]!, width, height)) {
        if (visited[n] === 0 && isOpaque(image, n)) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
    if (queue.length >= minPixels) blobs += 1;
  }
  return blobs;
}

export interface PostProcessPageInput {
  title: string;
  variants: readonly string[];
  // 1 行 = 1 組(キャラ・試行)。files は案ごとに、待機・通常・節目の順のファイル名
  rows: readonly { label: string; files: Readonly<Record<string, readonly string[]>> }[];
}

// --- 計測の実行(論点 0063 / 0064)---

const KINDS = ["idle", "regular", "milestone"] as const;

export interface PostProcessRunInput {
  title: string;
  sourceDir: string; // 論点 0062 の出力の、案ごとのモデルのフォルダ(<char>-<kind>-t<trial>.raw.png が並ぶ)
  outDir: string;
  characters: readonly string[];
  trials: readonly number[];
  width: number; // 縮小後の大きさ(アプリの保存の大きさ)
  height: number;
  variants: readonly string[];
  // 案ごとの後処理。cut = 背景を透明にする(small = 縮小した絵、raw = 縮小前の絵)、colorCount = 減らす色の数
  settingsOf: (variant: string) => {
    cut: (small: RgbaImage, raw: RgbaImage) => Promise<RgbaImage> | RgbaImage;
    colorCount: number;
  };
  minTransparentPct: number;
  maxTransparentPct: number;
}

export interface PostProcessVariantSummary {
  variant: string;
  images: number;
  meanTransparentPct: number;
  backgroundFailedCount: number; // 透明が少なすぎる・多すぎる
  meanAlphaChangedFromBaselinePct: number | null; // 最初の案(baseline)から透明かどうかが変わった画素
  meanColorError: number | null;
  skinKeptCount: number; // 肌に近い色がパレットに残った組の数
  pairCount: number;
  meanDominantHueSharePct: number | null; // 減色の前の色相の偏り(論点 0067)
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export async function runPostProcessComparison(
  input: PostProcessRunInput,
): Promise<PostProcessVariantSummary[]> {
  mkdirSync(input.outDir, { recursive: true });
  const baselineCut = new Map<string, RgbaImage>();
  const rows: { label: string; files: Record<string, string[]> }[] = [];
  const rowOf = (label: string): { label: string; files: Record<string, string[]> } => {
    let row = rows.find((r) => r.label === label);
    if (row === undefined) {
      row = { label, files: {} };
      rows.push(row);
    }
    return row;
  };

  const summaries: PostProcessVariantSummary[] = [];
  for (const [variantIndex, variant] of input.variants.entries()) {
    const { cut, colorCount } = input.settingsOf(variant);
    mkdirSync(join(input.outDir, variant), { recursive: true });
    const transparent: number[] = [];
    const alphaChanged: number[] = [];
    const colorErrors: number[] = [];
    const hueShares: number[] = [];
    let failed = 0;
    let skinKept = 0;
    let pairs = 0;
    for (const character of input.characters) {
      for (const trial of input.trials) {
        const label = `${character} / 試行 ${trial}`;
        // 画像タグを作れなかった組は絵が無い。数えずに飛ばす(論点 0067。全案で同じ組が欠けるので比べ方は変わらない)
        if (!existsSync(join(input.sourceDir, `${character}-idle-t${trial}.raw.png`))) continue;
        let palette: ImageColor[] = [];
        pairs += 1;
        for (const kind of KINDS) {
          const name = `${character}-${kind}-t${trial}`;
          const raw = decodePng(readFileSync(join(input.sourceDir, `${name}.raw.png`)));
          const small = downscaleImage(raw, input.width, input.height);
          const cutImage = await cut(small, raw);
          const hueShare = computeDominantHueSharePct(cutImage);
          if (hueShare !== null) hueShares.push(hueShare);
          if (kind === "idle") {
            palette = computeImagePalette(cutImage, colorCount);
            if (hasSkinColor(palette)) skinKept += 1;
          }
          const painted = applyImagePalette(cutImage, palette);
          const file = `${variant}/${name}.png`;
          writeFileSync(join(input.outDir, file), encodePng(painted));
          (rowOf(label).files[variant] ??= []).push(file);

          const pct = computeTransparentRatioPct(painted);
          transparent.push(pct);
          if (pct < input.minTransparentPct || pct > input.maxTransparentPct) failed += 1;
          const error = computeMeanColorError(cutImage, painted);
          if (error !== null) colorErrors.push(error);
          if (variantIndex === 0) baselineCut.set(name, cutImage);
          else alphaChanged.push(computeAlphaChangedPct(baselineCut.get(name)!, cutImage));
        }
      }
    }
    summaries.push({
      variant,
      images: transparent.length,
      meanTransparentPct: mean(transparent) ?? 0,
      backgroundFailedCount: failed,
      meanAlphaChangedFromBaselinePct: variantIndex === 0 ? null : mean(alphaChanged),
      meanColorError: mean(colorErrors),
      skinKeptCount: skinKept,
      pairCount: pairs,
      meanDominantHueSharePct: mean(hueShares),
    });
  }

  return summaries;
}
