// anthropic-text: TextGenerator の外部実装(Anthropic Messages API)。キャラ作成時のみ・明示同意後に呼ばれる。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは x-api-key ヘッダにのみ乗せる。
// OpenAI 実装との構造差: systemPrompt はトップレベル system、messages には user ロールが必要、
// seed パラメータは存在しない。

import type {
  ImageTagGenerator,
  ImageTagRequest,
  TextGenerator,
  TextGenerationRequest,
} from "../../core/providers/types.js";
import { TEXT_RESPONSE_SCHEMA } from "../../core/textResponse.js";
import { IMAGE_TAG_RESPONSE_SCHEMA } from "../../core/characterImage.js";
import { requireTextResponseMessages } from "./textResponseGuard.js";

export interface AnthropicTextConfig {
  apiKey: string;
  model: string; // 例: "claude-haiku-4-5-20251001"
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const RESPONSE_TOOL_NAME = "submit_cheer_messages";
const IMAGE_TAG_TOOL_NAME = "submit_image_tags";
// 画像タグは短い英語の語句が数個(論点 0036)。セリフの式(件数 × 係数)は当てられないので固定の上限にする
export const ANTHROPIC_IMAGE_TAG_MAX_TOKENS = 512;

// シナリオ: max_tokens を要求量から決める [境界]
// 1 文 30 字以内(docs/integrations.md 文字数契約)× 日本語のトークン化係数 2 + 記号分の余裕。
// 実疎通での実測後に調整しうるが、調整しても入出力契約は変わらない。
export const ANTHROPIC_TOKENS_PER_MESSAGE = 64;
export const ANTHROPIC_MAX_TOKENS_MARGIN = 256;

export function computeMaxTokens(count: number): number {
  return count * ANTHROPIC_TOKENS_PER_MESSAGE + ANTHROPIC_MAX_TOKENS_MARGIN;
}

interface AnthropicContentBlock {
  type?: string;
  input?: unknown;
}

interface AnthropicCall {
  system: string;
  userContent: string;
  maxTokens: number;
  toolName: string;
  toolDescription: string;
  schema: object;
  timeoutMs: number;
}

export function createAnthropicTextGenerator(
  config: AnthropicTextConfig,
): TextGenerator & ImageTagGenerator {
  const { apiKey, model, endpoint = DEFAULT_ENDPOINT, fetchFn = fetch } = config;

  // セリフと画像タグで違うのは system・user の本文・tool の名前とスキーマ・上限だけ
  async function call(c: AnthropicCall): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), c.timeoutMs);
    try {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": ANTHROPIC_VERSION,
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          model,
          max_tokens: c.maxTokens,
          // systemPrompt はトップレベル system に置く(messages の system ロールではない)
          system: c.system,
          // messages には最低 1 件の user ロールが必要
          messages: [{ role: "user", content: c.userContent }],
          // S0024_03 応答スキーマを tool で要求する。tool_choice で強制しないと、
          // モデルがツールを使わずテキストで返す余地が残る
          tools: [{ name: c.toolName, description: c.toolDescription, input_schema: c.schema }],
          tool_choice: { type: "tool", name: c.toolName },
          // シナリオ: Anthropic はシードを受け付けない [境界]
          // Messages API に seed は存在しないため request.seed は送らない。
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as { content?: AnthropicContentBlock[] };
      // text 要素(前置きなど)は読まない。tool_use が無ければ input は undefined(形式違反)
      return (data.content ?? []).find((block) => block.type === "tool_use")?.input;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: "anthropic",
    async generateMessages(request: TextGenerationRequest): Promise<string[]> {
      const raw = await call({
        system: request.systemPrompt,
        userContent: `${request.scenarioKey} の応援メッセージを ${request.count} 件、${RESPONSE_TOOL_NAME} で返してください。`,
        maxTokens: computeMaxTokens(request.count),
        toolName: RESPONSE_TOOL_NAME,
        toolDescription: "応援メッセージの配列を返す",
        schema: TEXT_RESPONSE_SCHEMA,
        timeoutMs: request.timeoutMs,
      });
      return requireTextResponseMessages(raw, "anthropic");
    },
    // 画像タグの要求(論点 0036)。検証は core/characterImage が持つので、応答はそのまま返す
    generateImageTags(request: ImageTagRequest): Promise<unknown> {
      return call({
        system: request.prompt,
        userContent: `画像タグを ${IMAGE_TAG_TOOL_NAME} で返してください。`,
        maxTokens: ANTHROPIC_IMAGE_TAG_MAX_TOKENS,
        toolName: IMAGE_TAG_TOOL_NAME,
        toolDescription: "画像生成用の英語のタグの配列を返す",
        schema: IMAGE_TAG_RESPONSE_SCHEMA,
        timeoutMs: request.timeoutMs,
      });
    },
  };
}
