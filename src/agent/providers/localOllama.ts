// local-ollama: TextGenerator のローカル実装(Ollama HTTP :11434)。キャラ作成時のみ呼ばれる。
// 要件: docs/integrations.md(呼び出し契約 / 未起動フォールバック / 自動リトライしない C6)
// 通信先は localhost の Ollama のみ。fetch は注入可能(テスト・タイムアウト制御のため)。

import type {
  ImageTagGenerator,
  ImageTagRequest,
  TextGenerator,
  TextGenerationRequest,
} from "../../core/providers/types.js";
import { TEXT_RESPONSE_SCHEMA } from "../../core/textResponse.js";
import { IMAGE_TAG_RESPONSE_SCHEMA } from "../../core/characterImage.js";
import { requireTextResponseMessages } from "./textResponseGuard.js";

export interface OllamaConfig {
  endpoint: string; // 例: "http://localhost:11434"(system.ollamaEndpoint)
  model: string; // 例: "sarashina2.2-3b-instruct"(system.ollamaModel)
  fetchFn?: typeof fetch;
}

export function createOllamaTextGenerator(config: OllamaConfig): TextGenerator & ImageTagGenerator {
  const { endpoint, model, fetchFn = fetch } = config;

  // セリフと画像タグで違うのは prompt と応答スキーマ(format)だけ
  async function generate(
    prompt: string,
    format: object,
    seed: number | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 自動リトライしない(C6): 失敗はそのまま throw し、再試行はユーザー判断
      const res = await fetchFn(`${endpoint}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          // S0024_01 応答スキーマを format で要求する(制約付きデコードで形を保証させる)
          format,
          options: seed !== undefined ? { seed } : {},
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as { response?: unknown };
      return data.response;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: "local-ollama",
    async generateMessages(request: TextGenerationRequest): Promise<string[]> {
      const raw = await generate(
        request.systemPrompt,
        TEXT_RESPONSE_SCHEMA,
        request.seed,
        request.timeoutMs,
      );
      return requireTextResponseMessages(raw, "local-ollama");
    },
    // 画像タグの要求(論点 0036)。検証は core/characterImage が持つので、応答はそのまま返す
    generateImageTags(request: ImageTagRequest): Promise<unknown> {
      return generate(request.prompt, IMAGE_TAG_RESPONSE_SCHEMA, request.seed, request.timeoutMs);
    },
  };
}
