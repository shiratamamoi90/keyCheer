// imageProcessComparison: ローカル画像生成の作り方を、今の作り方(baseline)と比べる計測(論点 0045)。
//
// 新しい作り方(人間の判断 2026-11-13):
//   1. 待機画像だけを文字から作る(単色の背景で描かせる)
//   2. regular / milestone の画像は、待機画像を下絵にして描き直す(img2img)
//   3. どの画像も、縁からつながる背景を透明にしてから、残った画素を待機画像から決めた 5 色に減らす
// 今の作り方(3 枚とも文字から作る)は imageModelComparison に baseline として残してある。作り直さず、
// 論点 0041 の計測の画像と並べて見る。
//
// アプリの実装にまだ無く、計測でだけやっていること(決まったら要件を書き換える論点を開いてから実装に入れる):
//   - 見た目の画像タグと、表情・ポーズの画像タグを別々に要求する(buildAppearanceTagPrompt / buildPoseTagPrompt)
//   - 固定のタグ(人物・背景・塗り)を足す(buildProcessPrompt)
//   - 下絵と強さを sd.cpp に渡す、背景を抜く、減色する
//
// 絵の良し悪しは指標にしない。並べて見る頁(buildProcessPage)を作り、人間が判断する。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePool } from "../agent/poolGenerator.js";
import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import {
  buildImageTagText,
  validateImageTagResponse,
  type CharacterImageKind,
  type ImageTagCharacter,
} from "../core/characterImage.js";
import { ALL_BUCKET_KEYS, computeCheerType, type MessagePool } from "../core/messagePool.js";
import {
  buildContainerOutputPath,
  computeImageSummary,
  createContainerSdRunner,
  escapeHtml,
  type ImageRecord,
  type ImageSummary,
  type ImageTagSettings,
  type ImageTrialSettings,
} from "./imageModelComparison.js";
import { decodePng, encodePng, type RgbaImage } from "./png.js";
import { EVAL_CHARACTERS } from "./textModelComparison.js";

export type DerivedImageKind = Exclude<CharacterImageKind, "idle">;
const DERIVED_IMAGE_KINDS: readonly DerivedImageKind[] = ["regular", "milestone"];

export type PaletteColor = readonly [number, number, number];

const RGBA_BYTES = 4;
const OPAQUE = 255;
// 半透明は持たない(抜くか残すかの 2 値)。この値以上を「残っている画素」とみなす
const MIN_OPAQUE_ALPHA = 128;
// 色を数えるときの粗さ。1 チャンネル 5 ビット(32 段)にまとめてから減色する(画素の数だけ箱を持たないため)
const HISTOGRAM_SHIFT = 3;
const HISTOGRAM_LEVELS = 1 << (8 - HISTOGRAM_SHIFT);
// 減色の仕上げ(近い色へ寄せ直す)の回数。回数で結果は変わるが、同じ入力なら同じ結果になる
const PALETTE_REFINE_COUNT = 10;
// 人物を指すタグ。見た目の画像タグに無いと、人物の描かれない絵が出うる(論点 0041 の result.md)
const PERSON_TAG_PATTERN = /\b1(girl|boy)\b/;
const FALLBACK_PERSON_TAG = "1girl";
// fixed_tags の中で背景のタグを入れる場所
export const BACKGROUND_PLACEHOLDER = "{background}";

// --- 画素の処理(どれも入力を書き換えず、新しい画像を返す) ---

function computeColorDistance(
  pixels: Uint8Array,
  offset: number,
  r: number,
  g: number,
  b: number,
): number {
  return Math.hypot(pixels[offset]! - r, pixels[offset + 1]! - g, pixels[offset + 2]! - b);
}

function listBorderOffsets(image: RgbaImage): number[] {
  const { width, height } = image;
  const offsets: number[] = [];
  for (let x = 0; x < width; x++) {
    offsets.push(x * RGBA_BYTES, ((height - 1) * width + x) * RGBA_BYTES);
  }
  for (let y = 1; y < height - 1; y++) {
    offsets.push(y * width * RGBA_BYTES, (y * width + width - 1) * RGBA_BYTES);
  }
  return offsets;
}

// 絵の縁でいちばん多い色を背景の色とする。プロンプトで頼んだ色(白)を決め打ちにしないのは、
// モデルが少し違う色(灰色がかった白など)で塗ることがあるため。
export function computeBackgroundColor(image: RgbaImage): PaletteColor {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const offset of listBorderOffsets(image)) {
    const r = image.pixels[offset]!;
    const g = image.pixels[offset + 1]!;
    const b = image.pixels[offset + 2]!;
    const key =
      ((r >> HISTOGRAM_SHIFT) * HISTOGRAM_LEVELS + (g >> HISTOGRAM_SHIFT)) * HISTOGRAM_LEVELS +
      (b >> HISTOGRAM_SHIFT);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const bucket of buckets.values()) if (bucket.count > best.count) best = bucket;
  if (best.count === 0) return [0, 0, 0];
  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ];
}

// 縁からつながっている背景の色の画素だけを透明にする(案T1)。
// なぜ「背景の色の画素を全部」にしないか:キャラクターの中の同じ色(白い服・白目)まで抜けるため。
// 縁からつながる所だけにすれば、輪郭線で囲まれた内側は残る。
//
// keyColor を渡すと、抜く色をその色に固定する(人間の判断 2026-11-13)。渡さなければ絵の縁から読む(1・2 回目の計測)。
// 縁から読む方式は、人物が縁まで届く絵で服や髪の色を背景と取り違えた(result.md「2 回目」)。
export function removeBackground(
  image: RgbaImage,
  tolerance: number,
  keyColor?: PaletteColor,
): RgbaImage {
  const { width, height } = image;
  const pixels = Uint8Array.from(image.pixels);
  const [r, g, b] = keyColor ?? computeBackgroundColor(image);
  const isBackground = (offset: number): boolean =>
    computeColorDistance(image.pixels, offset, r, g, b) <= tolerance;

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  for (const offset of listBorderOffsets(image)) {
    const index = offset / RGBA_BYTES;
    if (visited[index] === 0 && isBackground(offset)) {
      visited[index] = 1;
      queue.push(index);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    pixels.fill(0, index * RGBA_BYTES, (index + 1) * RGBA_BYTES);
    const x = index % width;
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      index >= width ? index - width : -1,
      index < width * (height - 1) ? index + width : -1,
    ];
    for (const next of neighbors) {
      if (next >= 0 && visited[next] === 0 && isBackground(next * RGBA_BYTES)) {
        visited[next] = 1;
        queue.push(next);
      }
    }
  }
  return { width, height, pixels };
}

interface ColorBucket {
  count: number;
  mean: [number, number, number];
}

function buildColorBuckets(image: RgbaImage): ColorBucket[] {
  const sums = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset < image.pixels.length; offset += RGBA_BYTES) {
    if (image.pixels[offset + 3]! < MIN_OPAQUE_ALPHA) continue;
    const r = image.pixels[offset]!;
    const g = image.pixels[offset + 1]!;
    const b = image.pixels[offset + 2]!;
    const key =
      ((r >> HISTOGRAM_SHIFT) * HISTOGRAM_LEVELS + (g >> HISTOGRAM_SHIFT)) * HISTOGRAM_LEVELS +
      (b >> HISTOGRAM_SHIFT);
    const sum = sums.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    sum.count += 1;
    sum.r += r;
    sum.g += g;
    sum.b += b;
    sums.set(key, sum);
  }
  // 同じ入力で同じ結果にするため、箱の並びをキーの順に固定する(Map の挿入順は画素の並びに依存する)
  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, sum]) => ({
      count: sum.count,
      mean: [sum.r / sum.count, sum.g / sum.count, sum.b / sum.count],
    }));
}

function computeWeightedMean(buckets: readonly ColorBucket[]): [number, number, number] {
  let count = 0;
  const total = [0, 0, 0];
  for (const bucket of buckets) {
    count += bucket.count;
    for (let c = 0; c < 3; c++) total[c]! += bucket.mean[c]! * bucket.count;
  }
  return [total[0]! / count, total[1]! / count, total[2]! / count];
}

function computeWidestChannel(buckets: readonly ColorBucket[]): { channel: number; range: number } {
  let channel = 0;
  let range = -1;
  for (let c = 0; c < 3; c++) {
    const values = buckets.map((bucket) => bucket.mean[c]!);
    const channelRange = Math.max(...values) - Math.min(...values);
    if (channelRange > range) {
      range = channelRange;
      channel = c;
    }
  }
  return { channel, range };
}

function findNearestIndex(
  centers: readonly (readonly number[])[],
  color: readonly number[],
): number {
  let nearest = 0;
  let nearestDistance = Infinity;
  centers.forEach((center, i) => {
    const distance = Math.hypot(
      center[0]! - color[0]!,
      center[1]! - color[1]!,
      center[2]! - color[2]!,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  });
  return nearest;
}

// 透明でない画素の色を、多くても maxColorCount 色にまとめる(案C1 の減色)。乱数を使わない:
// 色の広がりがいちばん大きい箱を、画素の数が半々になる所で割っていき(メディアンカット)、
// そのあと各色を近い画素の平均へ寄せ直す。
export function computePalette(image: RgbaImage, maxColorCount: number): number[][] {
  const buckets = buildColorBuckets(image);
  if (buckets.length === 0) return [];

  const boxes: ColorBucket[][] = [buckets];
  while (boxes.length < maxColorCount) {
    let target = -1;
    let targetChannel = 0;
    let targetRange = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { channel, range } = computeWidestChannel(box);
      if (range > targetRange) {
        target = i;
        targetChannel = channel;
        targetRange = range;
      }
    });
    if (target < 0) break;

    const sorted = [...boxes[target]!].sort(
      (a, b) => a.mean[targetChannel]! - b.mean[targetChannel]!,
    );
    const half = sorted.reduce((sum, bucket) => sum + bucket.count, 0) / 2;
    let splitAt = 1;
    let running = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      running += sorted[i]!.count;
      splitAt = i + 1;
      if (running >= half) break;
    }
    boxes.splice(target, 1, sorted.slice(0, splitAt), sorted.slice(splitAt));
  }

  let centers = boxes.map(computeWeightedMean);
  for (let round = 0; round < PALETTE_REFINE_COUNT; round++) {
    const groups: ColorBucket[][] = centers.map(() => []);
    for (const bucket of buckets) groups[findNearestIndex(centers, bucket.mean)]!.push(bucket);
    centers = groups.map((group, i) =>
      group.length === 0 ? centers[i]! : computeWeightedMean(group),
    );
  }

  const palette: number[][] = [];
  for (const center of centers) {
    const color = center.map(Math.round);
    if (!palette.some((p) => p[0] === color[0] && p[1] === color[1] && p[2] === color[2])) {
      palette.push(color);
    }
  }
  return palette;
}

// 透明でない画素を、パレットのいちばん近い色で塗る。待機画像から決めたパレットをほかの画像にも渡すと、
// 3 枚が同じ 5 色になる。
export function applyPalette(image: RgbaImage, palette: readonly (readonly number[])[]): RgbaImage {
  const pixels = new Uint8Array(image.pixels.length);
  if (palette.length === 0) return { width: image.width, height: image.height, pixels };
  // 同じ色を何度も探さないよう、粗くまとめた色ごとに結果を覚える
  const cache = new Map<number, number>();
  for (let offset = 0; offset < pixels.length; offset += RGBA_BYTES) {
    if (image.pixels[offset + 3]! < MIN_OPAQUE_ALPHA) continue;
    const r = image.pixels[offset]!;
    const g = image.pixels[offset + 1]!;
    const b = image.pixels[offset + 2]!;
    const key = (r << 16) | (g << 8) | b;
    let index = cache.get(key);
    if (index === undefined) {
      index = findNearestIndex(palette, [r, g, b]);
      cache.set(key, index);
    }
    const color = palette[index]!;
    pixels[offset] = color[0]!;
    pixels[offset + 1] = color[1]!;
    pixels[offset + 2] = color[2]!;
    pixels[offset + 3] = OPAQUE;
  }
  return { width: image.width, height: image.height, pixels };
}

// --- 指標(論点 0045「測り方」の自動指標)。どれも画素と記録から決定的に計算する ---

export function countOpaqueColors(image: RgbaImage): number {
  const colors = new Set<number>();
  for (let offset = 0; offset < image.pixels.length; offset += RGBA_BYTES) {
    if (image.pixels[offset + 3]! < MIN_OPAQUE_ALPHA) continue;
    colors.add(
      (image.pixels[offset]! << 16) | (image.pixels[offset + 1]! << 8) | image.pixels[offset + 2]!,
    );
  }
  return colors.size;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeTransparentRatioPct(image: RgbaImage): number {
  let transparentCount = 0;
  for (let offset = 3; offset < image.pixels.length; offset += RGBA_BYTES) {
    if (image.pixels[offset]! < MIN_OPAQUE_ALPHA) transparentCount += 1;
  }
  return roundToOneDecimal((transparentCount / (image.width * image.height)) * 100);
}

// 絵の縁の画素のうち、固定した背景の色になっている割合。頼んだ色で背景が塗られたかの目安
// (低ければ、モデルが別の色で塗ったか、人物が縁を覆っている)。
export function computeBackgroundMatchPct(
  image: RgbaImage,
  keyColor: PaletteColor,
  tolerance: number,
): number {
  const offsets = listBorderOffsets(image);
  const matchCount = offsets.filter(
    (offset) =>
      computeColorDistance(image.pixels, offset, keyColor[0], keyColor[1], keyColor[2]) <=
      tolerance,
  ).length;
  return roundToOneDecimal((matchCount / offsets.length) * 100);
}

// 待機画像から色が変わった画素の割合。下絵からどれだけ描き直されたかの目安
// (小さすぎればポーズが変わっていない、大きすぎれば別の絵になっている)。
export function computeChangedRatioPct(
  idle: RgbaImage,
  derived: RgbaImage,
  tolerance: number,
): number {
  if (idle.width !== derived.width || idle.height !== derived.height) {
    throw new Error("大きさの違う画像は比べられない");
  }
  let changedCount = 0;
  for (let offset = 0; offset < idle.pixels.length; offset += RGBA_BYTES) {
    const distance = computeColorDistance(
      derived.pixels,
      offset,
      idle.pixels[offset]!,
      idle.pixels[offset + 1]!,
      idle.pixels[offset + 2]!,
    );
    if (distance > tolerance) changedCount += 1;
  }
  return roundToOneDecimal((changedCount / (idle.width * idle.height)) * 100);
}

export interface ProcessRecord extends ImageRecord {
  // 下絵から描き直す強さ。待機画像(文字から作る)は null
  strength: number | null;
  // 後処理の前の画像(sd.cpp が出したまま)。失敗なら null
  rawFile: string | null;
  transparentRatioPct: number | null;
  colorCount: number | null;
  // 待機画像と比べて変わった画素の割合。待機画像そのものと、測れなかったときは null
  changedFromIdlePct: number | null;
  // 絵の縁のうち、固定した背景の色だった割合。抜く色を固定していないとき・失敗したときは null
  backgroundMatchPct: number | null;
}

export interface ProcessSummary extends ImageSummary {
  // 背景が抜けなかった(ほぼ透明にならない)・抜けすぎた(ほぼ全部が透明)画像の数
  backgroundFailedCount: number;
  // 絵の縁が、固定した背景の色でほとんど塗られていなかった画像の数
  backgroundMismatchCount: number;
  overColorLimitCount: number;
  meanChangedFromIdlePct: number | null;
}

export interface ProcessLimits {
  colorLimit: number;
  minTransparentPct: number;
  maxTransparentPct: number;
  minBackgroundMatchPct: number;
}

export function computeProcessSummary(
  variant: string,
  records: readonly ProcessRecord[],
  limits: ProcessLimits,
): ProcessSummary {
  const succeeded = records.filter((r) => !r.failed);
  const changed = succeeded.flatMap((r) =>
    r.changedFromIdlePct === null ? [] : [r.changedFromIdlePct],
  );
  return {
    ...computeImageSummary(variant, records),
    backgroundFailedCount: succeeded.filter(
      (r) =>
        r.transparentRatioPct !== null &&
        (r.transparentRatioPct < limits.minTransparentPct ||
          r.transparentRatioPct > limits.maxTransparentPct),
    ).length,
    backgroundMismatchCount: succeeded.filter(
      (r) => r.backgroundMatchPct !== null && r.backgroundMatchPct < limits.minBackgroundMatchPct,
    ).length,
    overColorLimitCount: succeeded.filter(
      (r) => r.colorCount !== null && r.colorCount > limits.colorLimit,
    ).length,
    meanChangedFromIdlePct:
      changed.length === 0
        ? null
        : roundToOneDecimal(changed.reduce((sum, pct) => sum + pct, 0) / changed.length),
  };
}

// --- プロンプト ---

// 見た目の画像タグの要求。待機画像にも、そこから作るほかの画像にも同じ見た目のタグを使う。
// 今の要求(core/characterImage の buildImageTagPrompt)は表情・ポーズ・雰囲気しか訊かないので、
// 画像の種類ごとに髪や服が変わった(論点 0041 の result.md「モデルの差ではない問題」1・2)。
export function buildAppearanceTagPrompt(character: ImageTagCharacter): string {
  return [
    "あなたは画像生成用のタグを考えます。",
    `キャラクター: ${character.name}`,
    `性格: ${character.personality}`,
    "このキャラクターの見た目を決めて、アニメ絵の画像生成で使う英語のタグで返してください。",
    "1girl か 1boy のどちらか 1 つ、髪の色、髪型、目の色、服装を、それぞれ小文字の英語 1〜3 語で書きます。",
    "例: 1girl, blonde hair, long hair, blue eyes, school uniform",
    "キャラクターの名前と、性格を表す語は入れないでください。",
  ].join("\n");
}

const POSE_KIND_LINE: Readonly<Record<DerivedImageKind, string>> = {
  regular: "次のような応援の言葉を話しているときの立ち絵です。",
  milestone: "節目を達成したときに、次のような言葉を話している立ち絵です。",
};

// 表情とポーズの画像タグの要求。見た目(髪・目・服)は待機画像のものを使うので訊かない
export function buildPoseTagPrompt(
  character: ImageTagCharacter,
  kind: DerivedImageKind,
  pool: MessagePool,
): string {
  const texts = ALL_BUCKET_KEYS.filter((key) => computeCheerType(key) === kind).flatMap((key) =>
    pool.buckets[key].map((m) => m.text),
  );
  return [
    "あなたは画像生成用のタグを考えます。",
    `キャラクター: ${character.name}`,
    `性格: ${character.personality}`,
    POSE_KIND_LINE[kind],
    ...texts.map((text) => `- ${text}`),
    "このときの表情とポーズだけを、アニメ絵の画像生成で使う英語のタグで 2〜4 個返してください。",
    "それぞれ小文字の英語 1〜3 語で書きます。髪・目・服は書かないでください。",
    "例: smile, open mouth, arms up",
  ].join("\n");
}

export interface ProcessPromptParts {
  // 人物・背景・塗りを指す固定のタグ(config.yaml の fixed_tags)。`{background}` を背景のタグに置き換える
  fixedTags: string;
  backgroundTag: string;
  appearanceTags: string;
  // 待機画像は空
  poseTags: string;
  loraName: string;
}

// 固定のタグ → 見た目 → 表情・ポーズ → LoRA の順で 1 本にする。
// 人物を指すタグが見た目に無ければ足す(テキストモデルが落とすことがあるため。足した数は記録に残す)。
export function buildProcessPrompt(parts: ProcessPromptParts): string {
  const appearance = PERSON_TAG_PATTERN.test(parts.appearanceTags)
    ? parts.appearanceTags
    : `${FALLBACK_PERSON_TAG}, ${parts.appearanceTags}`;
  // 背景のタグが空のとき(下地から描かせるときは色を言葉で頼まない)に、空のタグを残さない
  const fixedTags = parts.fixedTags
    .replaceAll(BACKGROUND_PLACEHOLDER, parts.backgroundTag)
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .join(", ");
  return [fixedTags, appearance, parts.poseTags, `<lora:${parts.loraName}:1>`]
    .filter((part) => part.length > 0)
    .join(", ");
}

export function hasPersonTag(appearanceTags: string): boolean {
  return PERSON_TAG_PATTERN.test(appearanceTags);
}

// --- 並べて見る頁 ---

export interface ProcessPageInput {
  models: readonly string[];
  records: readonly ProcessRecord[];
  // 今の作り方の画像。キーは `<モデル>/<キャラ>/<画像の種類>/<試行>`、値は頁からの相対パス
  baselineFiles: Readonly<Record<string, string>>;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function buildImageCell(records: readonly ProcessRecord[], isRaw: boolean): string {
  if (records.length === 0) return "<td>未計測</td>";
  const parts = records.map((record) => {
    const file = isRaw ? record.rawFile : record.file;
    const strength = record.strength === null ? "" : `強さ ${record.strength} / `;
    if (record.failed || file === null) {
      return `<figure>失敗<figcaption>${strength}${escapeHtml(record.error ?? "")}</figcaption></figure>`;
    }
    const detail = isRaw
      ? `${(record.latencyMs / 1000).toFixed(1)} 秒` +
        (record.changedFromIdlePct === null ? "" : ` / 変化 ${record.changedFromIdlePct}%`)
      : `透明 ${record.transparentRatioPct ?? "—"}% / ${record.colorCount ?? "—"} 色` +
        (record.backgroundMatchPct === null ? "" : ` / 縁の背景色 ${record.backgroundMatchPct}%`);
    return `<figure><img src="${encodePath(file)}" width="256" alt=""><figcaption>${strength}${detail}</figcaption></figure>`;
  });
  return `<td>${parts.join("")}</td>`;
}

// 同じケース(キャラ・画像の種類・試行)を 1 行にし、モデルごとに「今の作り方 / 後処理の前 / 後処理の後」を並べる。
// 透明になった所が分かるよう、画像の下に市松模様を敷く。
// プロンプトはモデルが出した画像タグを含むので、頁に埋める前に必ずエスケープする。
export function buildProcessPage(input: ProcessPageInput): string {
  const byCase = new Map<string, ProcessRecord[]>();
  for (const record of input.records) {
    const key = `${record.character}/${record.kind}/${record.trial}`;
    byCase.set(key, [...(byCase.get(key) ?? []), record]);
  }

  const rows = [...byCase.entries()].map(([key, group]) => {
    const first = group[0]!;
    const cells = input.models.map((model) => {
      const records = group.filter((r) => r.variant === model);
      const baseline = input.baselineFiles[`${model}/${key}`];
      const baselineCell =
        baseline === undefined
          ? "<td>—</td>"
          : `<td><figure><img src="${encodePath(baseline)}" width="256" alt=""></figure></td>`;
      return baselineCell + buildImageCell(records, true) + buildImageCell(records, false);
    });
    const label = `${escapeHtml(first.character)} / ${escapeHtml(first.kind)} / 試行 ${first.trial}(seed ${first.seed})`;
    return `<tr class="case"><th>${label}<br><small>${escapeHtml(first.prompt)}</small></th>${cells.join("")}</tr>`;
  });

  const modelHead = input.models
    .map((model) => `<th colspan="3">${escapeHtml(model)}</th>`)
    .join("");
  const columnHead = input.models
    .map(
      () =>
        "<th>今の作り方(論点 0041)</th><th>新しい作り方・後処理の前</th><th>新しい作り方・後処理の後</th>",
    )
    .join("");
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8"><title>画像の作り方の比較</title>',
    "<style>body{font-family:sans-serif}table{border-collapse:collapse}th,td{border:1px solid #999;padding:8px;vertical-align:top}th{max-width:320px;text-align:left;font-weight:normal}figure{display:inline-block;margin:0 8px 0 0}figcaption{font-size:small}img{background:repeating-conic-gradient(#bbb 0% 25%,#eee 0% 50%) 0 0/24px 24px}</style>",
    "</head><body><table>",
    `<tr><th rowspan="2">ケース</th>${modelHead}</tr>`,
    `<tr>${columnHead}</tr>`,
    ...rows,
    "</table></body></html>",
  ].join("\n");
}

// --- 計測の実行(ここから下は I/O) ---

export interface ProcessCase {
  character: string;
  trial: number;
  seed: number;
  // sd.cpp にそのまま渡すプロンプト(固定のタグ・LoRA の指定まで含む)
  idlePrompt: string;
  // 表情・ポーズの画像タグが取れた種類だけを持つ
  derivedPrompts: Partial<Record<DerivedImageKind, string>>;
  // 見た目の画像タグに人物を指すタグが無く、計測ドライバが足したか
  hasAddedPersonTag: boolean;
}

export interface ProcessTagSettings extends ImageTagSettings {
  fixedTags: string;
  backgroundTag: string;
  loraName: string;
}

// 画像タグを全ケース分作る。見た目のタグが取れなかったケースは 3 枚とも外す(待機画像が作れないため)。
export async function buildProcessCases(
  settings: ProcessTagSettings,
  onProgress: (message: string) => void,
): Promise<{ cases: ProcessCase[]; tagFailureCount: number }> {
  const generator = createOllamaTextGenerator({
    endpoint: settings.endpoint,
    model: settings.tagModel,
  });
  const requestTags = async (prompt: string, seed: number): Promise<string | null> => {
    try {
      const raw = await generator.generateImageTags({
        prompt,
        seed,
        timeoutMs: settings.timeoutMsPerBucket,
      });
      return validateImageTagResponse(raw).length > 0 ? null : buildImageTagText(raw);
    } catch {
      return null;
    }
  };

  const cases: ProcessCase[] = [];
  let tagFailureCount = 0;
  for (const character of EVAL_CHARACTERS.slice(0, settings.characterCount)) {
    onProgress(`${character.name}: セリフを作る`);
    const state = await generatePool({
      characterId: character.name,
      character,
      generator,
      seed: settings.baseSeed,
      timeoutMsPerBucket: settings.timeoutMsPerBucket,
    });
    for (let trial = 0; trial < settings.generationsPerCase; trial++) {
      const seed = settings.baseSeed + trial;
      const appearanceTags = await requestTags(buildAppearanceTagPrompt(character), seed);
      if (appearanceTags === null) {
        tagFailureCount += 1 + DERIVED_IMAGE_KINDS.length;
        continue;
      }
      const derivedPrompts: Partial<Record<DerivedImageKind, string>> = {};
      for (const kind of DERIVED_IMAGE_KINDS) {
        const poseTags = await requestTags(buildPoseTagPrompt(character, kind, state.pool), seed);
        if (poseTags === null) {
          tagFailureCount += 1;
          continue;
        }
        derivedPrompts[kind] = buildProcessPrompt({
          fixedTags: settings.fixedTags,
          backgroundTag: settings.backgroundTag,
          appearanceTags,
          poseTags,
          loraName: settings.loraName,
        });
      }
      cases.push({
        character: character.name,
        trial,
        seed,
        idlePrompt: buildProcessPrompt({
          fixedTags: settings.fixedTags,
          backgroundTag: settings.backgroundTag,
          appearanceTags,
          poseTags: "",
          loraName: settings.loraName,
        }),
        derivedPrompts,
        hasAddedPersonTag: !hasPersonTag(appearanceTags),
      });
    }
  }
  return { cases, tagFailureCount };
}

export interface ProcessTrialSettings extends ImageTrialSettings {
  // 下絵から描き直す強さ。本計測は 1 つ、強さを決める試しは複数
  strengths: readonly number[];
  // 下絵から描き直す画像だけに使うステップ数。強さは「ステップ数 × 強さ」の整数部の段に丸められるので、
  // 4 ステップでは 0.6〜0.7 が同じ絵になる(result.md「強さの試し・2 回目」)。細かく刻むには段を増やすしかない
  derivedSteps: number;
  // 待機画像のステップ数と、下地から描かせるときの強さ・下地の色(null なら下地を使わず文字だけから作る)
  idleSteps: number;
  idleStrength: number;
  idleCanvasColor: PaletteColor | null;
  // 抜く背景の色。null なら絵の縁から読む(1・2 回目の計測)
  backgroundColor: PaletteColor | null;
  backgroundTolerance: number;
  colorLimit: number;
  changedTolerance: number;
}

// 待機画像にだけ足す引数。下地(単色で塗りつぶした画像)を渡すと、背景がむらの無い 1 色になりやすい
// (result.md「3 回目」の参考)。下地の色そのものは残らないので、抜く色は絵の縁から読む。
export function buildIdleExtraArgs(
  settings: { steps: number; idleSteps: number; idleStrength: number },
  canvasPath: string | null,
): string[] {
  const args: string[] = [];
  // 同じ引数が 2 度あるときは後のものが使われる(もとのステップ数は createSdcppImageGenerator が渡す)
  if (settings.idleSteps !== settings.steps) args.push("--steps", String(settings.idleSteps));
  if (canvasPath !== null) {
    args.push("--init-img", canvasPath, "--strength", String(settings.idleStrength));
  }
  return args;
}

const CANVAS_NAME = "canvas";

export async function runProcessTrials(
  settings: ProcessTrialSettings,
  cases: readonly ProcessCase[],
  onRecord: (record: ProcessRecord) => void,
): Promise<ProcessRecord[]> {
  const variantOutDir = join(settings.outDir, settings.variant);
  mkdirSync(variantOutDir, { recursive: true });
  const runSd = createContainerSdRunner(settings);
  const records: ProcessRecord[] = [];
  let canvasPath: string | null = null;
  if (settings.idleCanvasColor !== null) {
    const pixels = new Uint8Array(settings.width * settings.height * RGBA_BYTES);
    for (let offset = 0; offset < pixels.length; offset += RGBA_BYTES) {
      pixels.set([...settings.idleCanvasColor, OPAQUE], offset);
    }
    writeFileSync(
      join(variantOutDir, `${CANVAS_NAME}.png`),
      encodePng({ width: settings.width, height: settings.height, pixels }),
    );
    canvasPath = buildContainerOutputPath(CANVAS_NAME);
  }
  const idleExtraArgs = buildIdleExtraArgs(settings, canvasPath);

  // 1 枚作って後処理まで行う。palette を渡さなければ、この画像から決める(待機画像)
  const runOne = async (
    base: Pick<ProcessRecord, "character" | "kind" | "trial" | "seed" | "prompt" | "strength">,
    name: string,
    extraArgs: readonly string[],
    idle: { raw: RgbaImage; palette: number[][] } | null,
  ): Promise<{ raw: RgbaImage; palette: number[][] } | null> => {
    const outcome = await runSd({
      name: `${name}.raw`,
      prompt: base.prompt,
      seed: base.seed,
      extraArgs,
    });
    let record: ProcessRecord = {
      ...base,
      variant: settings.variant,
      ...outcome,
      rawFile: null,
      file: null,
      transparentRatioPct: null,
      colorCount: null,
      changedFromIdlePct: null,
      backgroundMatchPct: null,
    };
    let produced: { raw: RgbaImage; palette: number[][] } | null = null;
    if (!outcome.failed) {
      try {
        const raw = decodePng(readFileSync(join(variantOutDir, `${name}.raw.png`)));
        const keyColor = settings.backgroundColor ?? undefined;
        const cut = removeBackground(raw, settings.backgroundTolerance, keyColor);
        const palette = idle?.palette ?? computePalette(cut, settings.colorLimit);
        const painted = applyPalette(cut, palette);
        writeFileSync(join(variantOutDir, `${name}.png`), encodePng(painted));
        record = {
          ...record,
          rawFile: `${settings.variant}/${name}.raw.png`,
          file: `${settings.variant}/${name}.png`,
          transparentRatioPct: computeTransparentRatioPct(painted),
          colorCount: countOpaqueColors(painted),
          changedFromIdlePct:
            idle === null ? null : computeChangedRatioPct(idle.raw, raw, settings.changedTolerance),
          backgroundMatchPct:
            keyColor === undefined
              ? null
              : computeBackgroundMatchPct(raw, keyColor, settings.backgroundTolerance),
        };
        produced = { raw, palette };
      } catch (e) {
        record = { ...record, failed: true, error: String(e) };
      }
    }
    records.push(record);
    onRecord(record);
    return produced;
  };

  for (const processCase of cases) {
    const { character, trial, seed } = processCase;
    const idleName = `${character}-idle-t${trial}`;
    const idle = await runOne(
      { character, kind: "idle", trial, seed, prompt: processCase.idlePrompt, strength: null },
      idleName,
      idleExtraArgs,
      null,
    );
    for (const strength of settings.strengths) {
      const suffix = settings.strengths.length > 1 ? `-s${strength}` : "";
      for (const kind of DERIVED_IMAGE_KINDS) {
        const prompt = processCase.derivedPrompts[kind];
        if (prompt === undefined) continue;
        const base = { character, kind, trial, seed, prompt, strength };
        if (idle === null) {
          // 待機画像が無ければ下絵が無いので作れない。作らなかったことを失敗として残す
          const record: ProcessRecord = {
            ...base,
            variant: settings.variant,
            latencyMs: 0,
            peakMemoryMb: null,
            failed: true,
            error: "待機画像が無いので作れない",
            rawFile: null,
            file: null,
            transparentRatioPct: null,
            colorCount: null,
            changedFromIdlePct: null,
            backgroundMatchPct: null,
          };
          records.push(record);
          onRecord(record);
          continue;
        }
        await runOne(
          base,
          `${character}-${kind}-t${trial}${suffix}`,
          [
            "--init-img",
            buildContainerOutputPath(`${idleName}.raw`),
            "--strength",
            String(strength),
            // 同じ引数が 2 度あるときは後のものが使われる(待機画像のステップ数は createSdcppImageGenerator が渡す)
            "--steps",
            String(settings.derivedSteps),
          ],
          idle,
        );
      }
    }
  }
  return records;
}
