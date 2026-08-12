// stability-image: ImageGenerator の外部実装(Stability AI v2beta stable-image core)。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは Authorization ヘッダにのみ乗せる。
// 1 リクエスト 1 枚のため count 回呼ぶ(openaiDalle と同型)。
// width/height は受け付けられないため aspect_ratio へ決定的に写像する。

import type { ImageGenerator, ImageGenerationRequest } from "../../core/providers/types.js";

export interface StabilityImageConfig {
  apiKey: string;
  endpoint?: string;
  outputFormat?: string; // png / jpeg / webp
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.stability.ai/v2beta/stable-image/generate/core";
const DEFAULT_OUTPUT_FORMAT = "png";

// シナリオ: width/height をアスペクト比へ写像する [境界]
// 許容値は実疎通時に公式ドキュメントで検証する。差し替えが 1 箇所で済むようここにまとめる。
export const STABILITY_ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "3:2",
  "5:4",
  "1:1",
  "4:5",
  "2:3",
  "9:16",
  "9:21",
] as const;

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w! / h!;
}

export function resolveAspectRatio(width: number, height: number): string {
  // シナリオ: 解決できないサイズはエラーにする [異常系]
  // 黙って別サイズで生成しない。
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`stability-ai: 解決できないサイズです (${width}x${height})`);
  }
  const target = width / height;
  let best = STABILITY_ASPECT_RATIOS[0] as string;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const ratio of STABILITY_ASPECT_RATIOS) {
    const delta = Math.abs(ratioValue(ratio) - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = ratio;
    }
  }
  return best;
}

export function createStabilityImageGenerator(config: StabilityImageConfig): ImageGenerator {
  const {
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    outputFormat = DEFAULT_OUTPUT_FORMAT,
    fetchFn = fetch,
  } = config;

  return {
    id: "stability-ai",
    async generateImages(request: ImageGenerationRequest): Promise<Uint8Array[]> {
      // サイズ解決は送信前に行う(解決できなければ 1 度も API を呼ばない)
      const aspectRatio = resolveAspectRatio(request.width, request.height);

      const images: Uint8Array[] = [];
      for (let i = 0; i < request.count; i += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), request.timeoutMs);
        try {
          const form = new FormData();
          form.set("prompt", request.prompt);
          // シナリオ: 同一シードで再現する — 表情差分でもシードは変えない
          form.set("seed", String(request.seed));
          form.set("aspect_ratio", aspectRatio);
          form.set("output_format", outputFormat);

          const res = await fetchFn(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              // accept: image/* で生バイト列を受け取る(application/json だと base64 JSON になる)
              accept: "image/*",
            },
            body: form,
            signal: controller.signal,
          });
          if (!res.ok) {
            throw new Error(`Stability AI HTTP ${res.status}: ${await res.text()}`);
          }
          images.push(new Uint8Array(await res.arrayBuffer()));
        } finally {
          clearTimeout(timer);
        }
      }
      return images;
    },
  };
}
