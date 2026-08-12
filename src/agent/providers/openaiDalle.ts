// openai-dalle: ImageGenerator の外部実装(OpenAI Images /v1/images/generations)。
// spec: 論点 0016 / docs/integrations.md
//   「通常/喜び/激励の 3 枚を表情タグ差し替えで生成」— ローカル(sd.cpp)と同じタグを使い、
//   1 リクエスト = 1 枚で count 回呼ぶ(dall-e-3 は n=1 のみ受け付けるため)。
// 失敗時は throw(自動リトライしない C6)。b64_json で受け取りバイト列にデコードする。
// 注: この API に seed 指定は無いため `request.seed` は送れない(同一シード再現は
//     [要確認] — docs/integrations.md「同一シードで再現」)。

import type { ImageGenerator, ImageGenerationRequest } from "../../core/providers/types.js";
import { EXPRESSION_TAGS, expressionTagAt } from "./expressions.js";

export interface OpenAIDalleConfig {
  apiKey: string;
  model: string; // 例: "dall-e-3"
  endpoint?: string;
  fetchFn?: typeof fetch;
  expressionTags?: string[];
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/images/generations";

export function createOpenAIDalleGenerator(config: OpenAIDalleConfig): ImageGenerator {
  const {
    apiKey,
    model,
    endpoint = DEFAULT_ENDPOINT,
    fetchFn = fetch,
    expressionTags = [...EXPRESSION_TAGS],
  } = config;

  return {
    id: "openai-dalle",
    async generateImages(request: ImageGenerationRequest): Promise<Uint8Array[]> {
      const controller = new AbortController();
      // 予算(timeoutMs)は 3 枚全体に掛ける。超過時は進行中のリクエストごと abort する。
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const images: Uint8Array[] = [];
        for (let i = 0; i < request.count; i++) {
          const res = await fetchFn(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              // ローカル実装と同じ「ベースプロンプト + 表情タグ」構成にする
              prompt: `${request.prompt}, ${expressionTagAt(i, expressionTags)}`,
              n: 1,
              size: `${request.width}x${request.height}`,
              response_format: "b64_json",
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            // 自動リトライしない(C6): 1 枚でも失敗したらユーザー判断に委ねる
            throw new Error(`OpenAI Images HTTP ${res.status}: ${await res.text()}`);
          }
          const data = (await res.json()) as { data?: { b64_json?: string }[] };
          for (const d of data.data ?? []) {
            images.push(new Uint8Array(Buffer.from(d.b64_json ?? "", "base64")));
          }
        }
        return images;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
