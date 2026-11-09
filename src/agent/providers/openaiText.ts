// openai-text: TextGenerator の外部実装(OpenAI Chat Completions)。キャラ作成時のみ・明示同意後に呼ばれる。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは Authorization ヘッダにのみ乗せる。

import type {
  ImageTagGenerator,
  ImageTagRequest,
  TextGenerator,
  TextGenerationRequest,
} from "../../core/providers/types.js";
import { TEXT_RESPONSE_SCHEMA } from "../../core/textResponse.js";
import { IMAGE_TAG_RESPONSE_SCHEMA } from "../../core/characterImage.js";
import { requireTextResponseMessages } from "./textResponseGuard.js";

export interface OpenAITextConfig {
  apiKey: string;
  model: string; // 例: "gpt-4o-mini"
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const RESPONSE_SCHEMA_NAME = "cheer_messages";
const IMAGE_TAG_SCHEMA_NAME = "image_tags";

export function createOpenAITextGenerator(
  config: OpenAITextConfig,
): TextGenerator & ImageTagGenerator {
  const { apiKey, model, endpoint = DEFAULT_ENDPOINT, fetchFn = fetch } = config;

  // セリフと画像タグで違うのは system の本文と応答スキーマだけ
  async function generate(
    prompt: string,
    schemaName: string,
    schema: object,
    seed: number | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: prompt }],
          // S0024_02 応答スキーマを strict json_schema で要求する(json_object では形を保証しない)
          response_format: {
            type: "json_schema",
            json_schema: { name: schemaName, strict: true, schema },
          },
          // 呼び出し側がシードを固定したときだけ渡す(再現性の不変条件 — impl-rules.md)。
          // ベストエフォート:OpenAI 側も seed 固定での完全一致は保証しない。
          ...(seed !== undefined ? { seed } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      return data.choices?.[0]?.message?.content;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: "openai",
    async generateMessages(request: TextGenerationRequest): Promise<string[]> {
      const raw = await generate(
        request.systemPrompt,
        RESPONSE_SCHEMA_NAME,
        TEXT_RESPONSE_SCHEMA,
        request.seed,
        request.timeoutMs,
      );
      return requireTextResponseMessages(raw, "openai");
    },
    // 画像タグの要求(論点 0036)。検証は core/characterImage が持つので、応答はそのまま返す
    generateImageTags(request: ImageTagRequest): Promise<unknown> {
      return generate(
        request.prompt,
        IMAGE_TAG_SCHEMA_NAME,
        IMAGE_TAG_RESPONSE_SCHEMA,
        request.seed,
        request.timeoutMs,
      );
    },
  };
}
