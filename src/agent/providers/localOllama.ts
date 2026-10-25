// local-ollama: TextGenerator のローカル実装(Ollama HTTP :11434)。キャラ作成時のみ呼ばれる。
// 要件: docs/integrations.md(呼び出し契約 / 未起動フォールバック / 自動リトライしない C6)
// 通信先は localhost の Ollama のみ。fetch は注入可能(テスト・タイムアウト制御のため)。

import type { TextGenerator, TextGenerationRequest } from "../../core/providers/types.js";
import { TEXT_RESPONSE_SCHEMA } from "../../core/textResponse.js";
import { requireTextResponseMessages } from "./textResponseGuard.js";

export interface OllamaConfig {
  endpoint: string; // 例: "http://localhost:11434"(system.ollamaEndpoint)
  model: string; // 例: "sarashina2.2-3b-instruct"(system.ollamaModel)
  fetchFn?: typeof fetch;
}

export function createOllamaTextGenerator(config: OllamaConfig): TextGenerator {
  const { endpoint, model, fetchFn = fetch } = config;
  return {
    id: "local-ollama",
    async generateMessages(request: TextGenerationRequest): Promise<string[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        // 自動リトライしない(C6): 失敗はそのまま throw し、再試行はユーザー判断
        const res = await fetchFn(`${endpoint}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: request.systemPrompt,
            stream: false,
            // S0024_01 応答スキーマを format で要求する(制約付きデコードで形を保証させる)
            format: TEXT_RESPONSE_SCHEMA,
            options: request.seed !== undefined ? { seed: request.seed } : {},
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as { response?: unknown };
        return requireTextResponseMessages(data.response, "local-ollama");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
