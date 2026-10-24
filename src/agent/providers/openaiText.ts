// openai-text: TextGenerator の外部実装(OpenAI Chat Completions)。キャラ作成時のみ・明示同意後に呼ばれる。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは Authorization ヘッダにのみ乗せる。

import type { TextGenerator, TextGenerationRequest } from "../../core/providers/types.js";
import { TEXT_RESPONSE_SCHEMA } from "../../core/textResponse.js";
import { requireTextResponseMessages } from "./textResponseGuard.js";

export interface OpenAITextConfig {
  apiKey: string;
  model: string; // 例: "gpt-4o-mini"
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const RESPONSE_SCHEMA_NAME = "cheer_messages";

export function createOpenAITextGenerator(config: OpenAITextConfig): TextGenerator {
  const { apiKey, model, endpoint = DEFAULT_ENDPOINT, fetchFn = fetch } = config;
  return {
    id: "openai",
    async generateMessages(request: TextGenerationRequest): Promise<string[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: request.systemPrompt }],
            // S0024_02 応答スキーマを strict json_schema で要求する(json_object では形を保証しない)
            response_format: {
              type: "json_schema",
              json_schema: {
                name: RESPONSE_SCHEMA_NAME,
                strict: true,
                schema: TEXT_RESPONSE_SCHEMA,
              },
            },
            // 呼び出し側がシードを固定したときだけ渡す(再現性の不変条件 — impl-rules.md)。
            // ベストエフォート:OpenAI 側も seed 固定での完全一致は保証しない。
            ...(request.seed !== undefined ? { seed: request.seed } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: unknown } }[];
        };
        return requireTextResponseMessages(data.choices?.[0]?.message?.content, "openai");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
