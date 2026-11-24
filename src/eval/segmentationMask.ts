// 人物を切り抜くモデル(u2netp。rembg が配っているもの)で背景を透明にする計測(論点 0063)。
// 入力の作り方は rembg の u2netp と同じ(320x320 に縮め、最大値で割り、ImageNet の平均・標準偏差で正規化する)。
//
// ONNX の実行ライブラリ(onnxruntime-node)はアプリの依存に入れていない(採るかは論点で決める)。計測では
// scripts/fetch-seg-eval.sh がリポジトリの外に置いたものを、置き場から読み込む。

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RgbaImage } from "./png.js";

const RGBA_BYTES = 4;
const OPAQUE = 255;
// rembg の u2netp の入力の大きさと正規化(ImageNet の平均・標準偏差)
export const U2NET_INPUT_SIZE = 320;
const CHANNEL_MEAN = [0.485, 0.456, 0.406];
const CHANNEL_STD = [0.229, 0.224, 0.225];

// 両端をそろえた双線形補間で 1 つの値を読む
function sampleBilinear(
  read: (x: number, y: number) => number,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = read(x0, y0) * (1 - tx) + read(x1, y0) * tx;
  const bottom = read(x0, y1) * (1 - tx) + read(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function scaleOf(from: number, to: number): number {
  return to > 1 ? (from - 1) / (to - 1) : 0;
}

// モデルへの入力(1 x 3 x size x size。チャンネルが先)
export function buildU2netInput(image: RgbaImage, size = U2NET_INPUT_SIZE): Float32Array {
  const values = new Float32Array(3 * size * size);
  const sx = scaleOf(image.width, size);
  const sy = scaleOf(image.height, size);
  let max = 0;
  for (let c = 0; c < 3; c++) {
    const read = (x: number, y: number): number =>
      image.pixels[(y * image.width + x) * RGBA_BYTES + c]!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = sampleBilinear(read, image.width, image.height, x * sx, y * sy);
        values[c * size * size + y * size + x] = value;
        if (value > max) max = value;
      }
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < size * size; i++) {
      const index = c * size * size + i;
      const scaled = max === 0 ? 0 : values[index]! / max;
      values[index] = (scaled - CHANNEL_MEAN[c]!) / CHANNEL_STD[c]!;
    }
  }
  return values;
}

// 出力を 0〜1 に引き伸ばす(rembg と同じ)。全部同じ値なら 0
export function computeNormalizedProbability(map: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of map) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  return map.map((v) => (range === 0 ? 0 : (v - min) / range));
}

export function resizeProbabilityMap(
  map: Float32Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Float32Array {
  const out = new Float32Array(outWidth * outHeight);
  const sx = scaleOf(width, outWidth);
  const sy = scaleOf(height, outHeight);
  const read = (x: number, y: number): number => map[y * width + x]!;
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      out[y * outWidth + x] = sampleBilinear(read, width, height, x * sx, y * sy);
    }
  }
  return out;
}

// 確率が threshold 未満の画素を透明に、ほかを完全に不透明にする(アプリの絵は半透明の画素を持たない。S0046_11)
export function applyProbabilityMask(
  image: RgbaImage,
  probability: Float32Array,
  threshold: number,
): RgbaImage {
  const pixels = Uint8Array.from(image.pixels);
  for (let i = 0; i < image.width * image.height; i++) {
    if (probability[i]! < threshold) pixels.fill(0, i * RGBA_BYTES, (i + 1) * RGBA_BYTES);
    else pixels[i * RGBA_BYTES + 3] = OPAQUE;
  }
  return { width: image.width, height: image.height, pixels };
}

interface OrtModule {
  InferenceSession: {
    create(path: string): Promise<{
      inputNames: readonly string[];
      outputNames: readonly string[];
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
    }>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
}

// 置き場の onnxruntime-node と重みで、絵ごとに「人物である確率」(0〜1。大きさは絵と同じ)を返す関数を作る
export async function createU2netSegmenter(
  dir: string,
  modelFile: string,
): Promise<(image: RgbaImage, outWidth: number, outHeight: number) => Promise<Float32Array>> {
  const entry = pathToFileURL(join(dir, "node_modules", "onnxruntime-node", "dist", "index.js"));
  const loaded = (await import(entry.href)) as { default?: OrtModule } & OrtModule;
  const ort = loaded.default ?? loaded;
  const session = await ort.InferenceSession.create(join(dir, modelFile));
  return async (image, outWidth, outHeight) => {
    const input = new ort.Tensor("float32", buildU2netInput(image), [
      1,
      3,
      U2NET_INPUT_SIZE,
      U2NET_INPUT_SIZE,
    ]);
    const output = await session.run({ [session.inputNames[0]!]: input });
    // 最初の出力がいちばん細かい予測(rembg も最初の出力を使う)
    const map = computeNormalizedProbability(output[session.outputNames[0]!]!.data);
    return resizeProbabilityMap(map, U2NET_INPUT_SIZE, U2NET_INPUT_SIZE, outWidth, outHeight);
  };
}
