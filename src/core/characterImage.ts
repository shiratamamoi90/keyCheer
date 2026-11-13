// characterImage: キャラ画像の画像タグの要求・応答のパース・縮小後の大きさ・ローカル画像生成の作り方。純粋関数のみ。
// spec: 論点 0036 / docs/integrations.md「画像タグの要求」「ローカル画像生成の作り方」/ docs/pool-generation.md「生成でキャラ画像も作る」
//
// 画像タグの良し悪し(セリフやキャラに合った絵になるか)は縛らない(非決定的)。ここが持つのは
// 要求に何を入れ何を入れないか、応答の形、保存する大きさ。
// 応援発動経路からは import しない(生成時だけの処理。core/index.ts にも再エクスポートしない)。

import { ALL_BUCKET_KEYS, computeCheerType, type MessagePool } from "./messagePool.js";
import type { CheerType } from "./shared/types.js";

// 1 キャラ 3 枚。idle = 待機画像、regular / milestone = その応援種別の画像(論点 0036)
export const CHARACTER_IMAGE_KINDS = ["idle", "regular", "milestone"] as const;
export type CharacterImageKind = (typeof CHARACTER_IMAGE_KINDS)[number];

export interface ImageTagCharacter {
  name: string;
  personality: string;
}

// 応答スキーマ(docs/integrations.md「画像タグの要求」)。3 実装で共通。
// トップレベルをオブジェクトにするのはセリフの応答スキーマと同じ理由(OpenAI strict / Anthropic tool 入力)。
export const IMAGE_TAG_RESPONSE_SCHEMA = {
  type: "object",
  properties: { tags: { type: "array", items: { type: "string" } } },
  required: ["tags"],
  additionalProperties: false,
} as const;

const KIND_LINE: Readonly<Record<CharacterImageKind, string>> = {
  idle: "セリフを話していないときの、ふだんの立ち絵です。",
  regular: "次のような応援のセリフを話しているときの立ち絵です。",
  milestone: "節目を達成したときに、次のようなセリフを話している立ち絵です。",
};

// S0036_01 画像 1 枚につき 1 回、画像タグを要求する — 要求の中身
// S0036_02 待機画像の要求にセリフを入れない
// S0036_03 応援種別の画像の要求にほかの応援種別のセリフを入れない
//
// なぜ待機画像にセリフを入れないか:待機画像は応援が出ていないときの絵で、特定のセリフの表情に
// 寄せると「応援していないのに応援している絵」になる。応援種別ごとに分けるのは、milestone の
// 祝う表情が regular の絵に混ざらないようにするため。
export function buildImageTagPrompt(
  character: ImageTagCharacter,
  kind: CharacterImageKind,
  pool: MessagePool,
): string {
  const lines = [
    "あなたは画像生成用のタグを考えます。",
    `キャラクター: ${character.name}`,
    `性格: ${character.personality}`,
    KIND_LINE[kind],
  ];
  if (kind !== "idle") {
    for (const text of selectMessageTexts(pool, kind)) lines.push(`- ${text}`);
  }
  lines.push(
    "このキャラクターの立ち絵を描くための、表情・ポーズ・雰囲気を表す英語の短いタグを返してください。",
  );
  return lines.join("\n");
}

function selectMessageTexts(pool: MessagePool, type: CheerType): string[] {
  return ALL_BUCKET_KEYS.filter((key) => computeCheerType(key) === type).flatMap((key) =>
    pool.buckets[key].map((m) => m.text),
  );
}

// Ollama / OpenAI は JSON 文字列、Anthropic の tool_use.input は解析済みのオブジェクトで返る
function parsePayload(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof raw !== "string") return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function normalizedTags(tags: readonly string[]): string[] {
  return tags.map((t) => t.trim()).filter((t) => t.length > 0);
}

// S0036_05 画像タグの形式違反はその画像だけ失敗にする — ここは検出だけ。失敗への落とし方は呼び出し側
export function validateImageTagResponse(raw: unknown): string[] {
  const parsed = parsePayload(raw);
  if (!parsed.ok) return ["image tag response is not valid JSON"];
  const value = parsed.value;
  if (typeof value !== "object" || value === null) return ["image tag response is not an object"];
  const tags = (value as Record<string, unknown>).tags;
  if (tags === undefined) return ["image tag response has no tags"];
  if (!Array.isArray(tags)) return ["image tag response tags is not an array"];
  if (!tags.every((t) => typeof t === "string")) {
    return ["image tag response tags contains a non-string element"];
  }
  if (normalizedTags(tags).length === 0) return ["image tag response has no usable tag"];
  return [];
}

// S0036_04 画像タグを連結してプロンプトにする
// validateImageTagResponse が空を返した応答だけを渡す前提(形の検査をここで繰り返さない)。
export function buildImageTagText(raw: unknown): string {
  const parsed = parsePayload(raw);
  const tags = parsed.ok ? (parsed.value as { tags: string[] }).tags : [];
  return normalizedTags(tags).join(", ");
}

// S0036_15 縮小して PNG で保存する — 保存する大きさ
// 出典は論点 0036(256x384。縦長の窓に立ち絵がおさまる大きさ)。データ量を抑えるための上限で、
// 生成の大きさ(system.imageGen の 512x768)とは別。小さい画像を拡大しないのは、データ量が増えるだけで
// 細部は戻らないため。
export const MAX_IMAGE_WIDTH = 256;
export const MAX_IMAGE_HEIGHT = 384;

export function computeImageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// --- ローカル画像生成の作り方(local-sdcpp だけ。論点 0045 / 0046)---
// 値はどれも論点 0045 が計測で決めたもの(decisions/decided/0045-image-generation-process/config.yaml)。
// 変えるときは計測し直す。外部の画像プロバイダーには当てない(S0046_16)。

// アプリが画像タグの前に足す語。背景の色は言葉で頼まない(頼んだ色で塗られず、色が人物に移るため。論点 0045 の 3 回目)
const LOCAL_IMAGE_FIXED_TAGS = "solo, upper body, simple background, flat color, limited palette";
// LCM LoRA のファイル名(拡張子なし)。sd.cpp はプロンプトの <lora:名前:強さ> で読む
const LOCAL_IMAGE_LORA_NAME = "lcm-lora-sdv1-5";
// 人物を指す語。画像タグに無いと、人物の描かれない絵が出うる(論点 0041 の result.md)
const PERSON_TAG_PATTERN = /\b1(girl|boy)\b/;
const FALLBACK_PERSON_TAG = "1girl";

const LOCAL_POSE_KIND_LINE: Readonly<Record<CheerType, string>> = {
  regular: "次のような応援の言葉を話しているときの立ち絵です。",
  milestone: "節目を達成したときに、次のような言葉を話している立ち絵です。",
};

// S0049_01 待機画像の画像タグの要求は見た目を訊く
// S0049_02 応援種別の画像の画像タグの要求は表情とポーズだけを訊く
//
// 文面は論点 0045 の計測で使ったもの(src/eval/imageProcessComparison.ts と同じ文)。絵を確かめたのはこの文だけなので、
// 言い回しを変えるときは計測し直す。待機画像で見た目を決めておくのは、その画像タグを応援種別の画像にも足して
// 人物を保つため(S0046_03)。応援種別の画像で髪・目・服を訊かないのは、待機画像と食い違う語が出ると別の人物になるため。
// 外部の画像プロバイダーには使わない(S0049_03。外部は 3 枚を別々に作るので buildImageTagPrompt のまま)。
export function buildLocalImageTagPrompt(
  character: ImageTagCharacter,
  kind: CharacterImageKind,
  pool: MessagePool,
): string {
  const head = [
    "あなたは画像生成用のタグを考えます。",
    `キャラクター: ${character.name}`,
    `性格: ${character.personality}`,
  ];
  if (kind === "idle") {
    return [
      ...head,
      "このキャラクターの見た目を決めて、アニメ絵の画像生成で使う英語のタグで返してください。",
      "1girl か 1boy のどちらか 1 つ、髪の色、髪型、目の色、服装を、それぞれ小文字の英語 1〜3 語で書きます。",
      "例: 1girl, blonde hair, long hair, blue eyes, school uniform",
      "キャラクターの名前と、性格を表す語は入れないでください。",
    ].join("\n");
  }
  return [
    ...head,
    LOCAL_POSE_KIND_LINE[kind],
    ...selectMessageTexts(pool, kind).map((text) => `- ${text}`),
    "このときの表情とポーズだけを、アニメ絵の画像生成で使う英語のタグで 2〜4 個返してください。",
    "それぞれ小文字の英語 1〜3 語で書きます。髪・目・服は書かないでください。",
    "例: smile, open mouth, arms up",
  ].join("\n");
}

// S0046_06 待機画像は白の下地から強さ 0.9・4 ステップで描く
export const LOCAL_IDLE_STRENGTH = 0.9;
export const LOCAL_IDLE_STEPS = 4;
// S0046_07 応援種別の画像は待機画像を下絵に強さ 0.65・8 ステップで描く
export const LOCAL_DERIVED_STRENGTH = 0.65;
export const LOCAL_DERIVED_STEPS = 8;

// S0046_01 プロンプトは固定の語・画像タグ・LoRA の指定の順に組み立てる
// S0046_02 人物の語が画像タグに無ければ 1girl を足す
// S0046_03 応援種別の画像のプロンプトは待機画像の画像タグにその画像の画像タグを足す
//
// なぜ応援種別の画像にも待機画像の画像タグを入れるか:表情とポーズの語だけだと、描き直しで髪や服が変わり
// 別の人物になる(計測はこの形で 3 枚が同じ人物に見えることを確かめた)。
export function buildLocalImagePrompt(idleTags: string, kindTags = ""): string {
  const person = PERSON_TAG_PATTERN.test(idleTags) ? "" : FALLBACK_PERSON_TAG;
  return [LOCAL_IMAGE_FIXED_TAGS, person, idleTags, kindTags, `<lora:${LOCAL_IMAGE_LORA_NAME}:1>`]
    .filter((part) => part.length > 0)
    .join(", ");
}

// 画素の並び。1 画素 = R・G・B・アルファの 4 バイト(左上から右へ、上から下へ)
export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export type ImageColor = readonly [number, number, number];

const RGBA_BYTES = 4;
const OPAQUE_ALPHA = 255;
// S0046_09 背景の色との色の差がこの値以内なら背景とみなす(R・G・B の差の 2 乗の和の平方根)
const MAX_BACKGROUND_COLOR_DISTANCE = 48;
// S0046_11 保存する絵の不透明の色の上限(透明は数えない)
export const MAX_IMAGE_COLOR_COUNT = 7;
// 減色で、割って決めた色を近い画素の平均へ寄せ直す回数(計測ドライバと同じ値)
const PALETTE_REFINE_COUNT = 10;

function computeColorDistance(a: ImageColor, b: ImageColor): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function colorAt(image: RgbaImage, index: number): ImageColor {
  const offset = index * RGBA_BYTES;
  return [image.pixels[offset]!, image.pixels[offset + 1]!, image.pixels[offset + 2]!];
}

function colorKey(color: ImageColor): number {
  return (color[0] << 16) | (color[1] << 8) | color[2];
}

// 絵の縁(いちばん外側の 1 画素の列と行)の画素の番号
function listBorderIndexes(image: RgbaImage): number[] {
  const { width, height } = image;
  const indexes: number[] = [];
  for (let x = 0; x < width; x++) {
    indexes.push(x);
    if (height > 1) indexes.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    indexes.push(y * width);
    if (width > 1) indexes.push(y * width + width - 1);
  }
  return indexes;
}

// 縁でいちばん多い色。同じ数なら色の値の小さいほう(同じ絵から同じ結果にするため)
function computeBackgroundColor(image: RgbaImage): ImageColor {
  const counts = new Map<number, { count: number; color: ImageColor }>();
  for (const index of listBorderIndexes(image)) {
    const color = colorAt(image, index);
    const entry = counts.get(colorKey(color)) ?? { count: 0, color };
    entry.count += 1;
    counts.set(colorKey(color), entry);
  }
  let best: { count: number; color: ImageColor } = { count: 0, color: [0, 0, 0] };
  for (const [, entry] of [...counts.entries()].sort(([a], [b]) => a - b)) {
    if (entry.count > best.count) best = { count: entry.count, color: entry.color };
  }
  return best.color;
}

// S0046_09 縁からつながる背景の色を透明にする
// S0046_10 背景に近い色でも縁からつながらない所は透明にしない
//
// なぜ「背景の色の画素を全部」にしないか:キャラクターの中の同じ色(白い服・白目)まで抜けるため。
// 縁からたどれる所だけにすれば、輪郭線で囲まれた内側は残る。それでも服や髪が背景に近い色で縁まで届くと
// 一緒に抜ける。この抜けそこないは受け入れると決めている(論点 0045 の決定 6)。
// 残した画素は完全に不透明にする(S0046_11 半透明の画素を持たない)。
export function applyBackgroundRemoval(image: RgbaImage): RgbaImage {
  const { width, height } = image;
  const pixels = Uint8Array.from(image.pixels);
  for (let offset = 3; offset < pixels.length; offset += RGBA_BYTES) pixels[offset] = OPAQUE_ALPHA;

  const background = computeBackgroundColor(image);
  const isBackground = (index: number): boolean =>
    computeColorDistance(colorAt(image, index), background) <= MAX_BACKGROUND_COLOR_DISTANCE;

  const isVisited = new Uint8Array(width * height);
  const queue: number[] = [];
  for (const index of listBorderIndexes(image)) {
    if (isVisited[index] === 0 && isBackground(index)) {
      isVisited[index] = 1;
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
      if (next >= 0 && isVisited[next] === 0 && isBackground(next)) {
        isVisited[next] = 1;
        queue.push(next);
      }
    }
  }
  return { width, height, pixels };
}

interface ColorCount {
  count: number;
  color: ImageColor;
}

// 不透明の画素の色と、その画素の数。色の値の順に並べる(Map の挿入順は画素の並びに依存するため)
function listOpaqueColors(image: RgbaImage): ColorCount[] {
  const counts = new Map<number, ColorCount>();
  for (let index = 0; index < image.width * image.height; index++) {
    if (image.pixels[index * RGBA_BYTES + 3] !== OPAQUE_ALPHA) continue;
    const color = colorAt(image, index);
    const entry = counts.get(colorKey(color)) ?? { count: 0, color };
    entry.count += 1;
    counts.set(colorKey(color), entry);
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry);
}

function computeWeightedMean(colors: readonly ColorCount[]): [number, number, number] {
  let count = 0;
  const total: [number, number, number] = [0, 0, 0];
  for (const entry of colors) {
    count += entry.count;
    for (let c = 0; c < 3; c++) total[c]! += entry.color[c]! * entry.count;
  }
  return [total[0] / count, total[1] / count, total[2] / count];
}

function computeWidestChannel(colors: readonly ColorCount[]): { channel: number; range: number } {
  let channel = 0;
  let range = -1;
  for (let c = 0; c < 3; c++) {
    const values = colors.map((entry) => entry.color[c]!);
    const channelRange = Math.max(...values) - Math.min(...values);
    if (channelRange > range) {
      range = channelRange;
      channel = c;
    }
  }
  return { channel, range };
}

function resolveNearestIndex(palette: readonly ImageColor[], color: ImageColor): number {
  let nearest = 0;
  let nearestDistance = Infinity;
  palette.forEach((candidate, i) => {
    const distance = computeColorDistance(candidate, color);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  });
  return nearest;
}

// S0046_11 保存する絵は 7 色以下 — 絵の不透明の画素から、多くても 7 色を決める
// S0046_12 不透明の色が 7 色以下ならその色のまま
//
// 乱数を使わない(S0046_14 同じ絵からは同じ絵)。色の広がりがいちばん大きい箱を、画素の数が半々になる所で
// 割っていき(メディアンカット)、そのあと各色を近い画素の平均へ寄せ直す。計測ドライバと同じ考え方。
export function computeImagePalette(image: RgbaImage): ImageColor[] {
  const colors = listOpaqueColors(image);
  if (colors.length <= MAX_IMAGE_COLOR_COUNT) return colors.map((entry) => entry.color);

  const boxes: ColorCount[][] = [colors];
  while (boxes.length < MAX_IMAGE_COLOR_COUNT) {
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
      (a, b) => a.color[targetChannel]! - b.color[targetChannel]!,
    );
    const half = sorted.reduce((sum, entry) => sum + entry.count, 0) / 2;
    let splitAt = 1;
    let running = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      running += sorted[i]!.count;
      splitAt = i + 1;
      if (running >= half) break;
    }
    boxes.splice(target, 1, sorted.slice(0, splitAt), sorted.slice(splitAt));
  }

  let centers: ImageColor[] = boxes.map(computeWeightedMean);
  for (let round = 0; round < PALETTE_REFINE_COUNT; round++) {
    const groups: ColorCount[][] = centers.map(() => []);
    for (const entry of colors) groups[resolveNearestIndex(centers, entry.color)]!.push(entry);
    centers = groups.map((group, i) =>
      group.length === 0 ? centers[i]! : computeWeightedMean(group),
    );
  }

  const palette: ImageColor[] = [];
  for (const center of centers) {
    const color: ImageColor = [Math.round(center[0]), Math.round(center[1]), Math.round(center[2])];
    if (!palette.some((p) => colorKey(p) === colorKey(color))) palette.push(color);
  }
  return palette;
}

// S0046_13 応援種別の画像は待機画像の色だけで塗る — 不透明の画素を、渡した色のうちいちばん近い色に置き換える
//
// 渡した色が 1 つも無いとき(待機画像が全部透明だった)は色を変えない。このときの扱いは要件で決まっていない
// (docs/integrations.md の [要確認])。決まるまでは、絵を壊さないほうに倒している。
export function applyImagePalette(image: RgbaImage, palette: readonly ImageColor[]): RgbaImage {
  const pixels = Uint8Array.from(image.pixels);
  if (palette.length === 0) return { width: image.width, height: image.height, pixels };
  const nearestByColor = new Map<number, ImageColor>();
  for (let index = 0; index < image.width * image.height; index++) {
    const offset = index * RGBA_BYTES;
    if (pixels[offset + 3] !== OPAQUE_ALPHA) continue;
    const color = colorAt(image, index);
    let nearest = nearestByColor.get(colorKey(color));
    if (nearest === undefined) {
      nearest = palette[resolveNearestIndex(palette, color)]!;
      nearestByColor.set(colorKey(color), nearest);
    }
    pixels.set(nearest, offset);
  }
  return { width: image.width, height: image.height, pixels };
}

// 1 画素の 1 番目と 3 番目の色を入れ替えた絵を返す(R・G・B・A ⇄ B・G・R・A)。
// Electron の nativeImage の画素は B・G・R・A の順なので、main がこの関数で行き来する(実物で確かめた並び)。
// 後処理(背景を透明にする・減色)は色の差しか見ないので、どちらの並びでも結果は変わらないが、
// 残しておく待機画像の色(R・G・B)と並びを揃えるために入れ替える。
export function applyRedBlueSwap(image: RgbaImage): RgbaImage {
  const pixels = Uint8Array.from(image.pixels);
  for (let offset = 0; offset < pixels.length; offset += RGBA_BYTES) {
    pixels[offset] = image.pixels[offset + 2]!;
    pixels[offset + 2] = image.pixels[offset]!;
  }
  return { width: image.width, height: image.height, pixels };
}
