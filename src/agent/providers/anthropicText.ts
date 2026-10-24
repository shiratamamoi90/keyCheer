// anthropic-text: TextGenerator の外部実装(Anthropic Messages API)。キャラ作成時のみ・明示同意後に呼ばれる。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは x-api-key ヘッダにのみ乗せる。
// OpenAI 実装との構造差: systemPrompt はトップレベル system、messages には user ロールが必要、
// seed パラメータは存在しない。

import type { TextGenerator, TextGenerationRequest } from "../../core/providers/types.js";
import { TEXT_RESPONSE_SCHEMA } from "../../core/textResponse.js";
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

export function createAnthropicTextGenerator(config: AnthropicTextConfig): TextGenerator {
  const { apiKey, model, endpoint = DEFAULT_ENDPOINT, fetchFn = fetch } = config;
  return {
    id: "anthropic",
    async generateMessages(request: TextGenerationRequest): Promise<string[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
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
            max_tokens: computeMaxTokens(request.count),
            // systemPrompt はトップレベル system に置く(messages の system ロールではない)
            system: request.systemPrompt,
            // messages には最低 1 件の user ロールが必要
            messages: [
              {
                role: "user",
                content: `${request.scenarioKey} の応援メッセージを ${request.count} 件、${RESPONSE_TOOL_NAME} で返してください。`,
              },
            ],
            // S0024_03 応答スキーマを tool で要求する。tool_choice で強制しないと、
            // モデルがツールを使わずテキストで返す余地が残る
            tools: [
              {
                name: RESPONSE_TOOL_NAME,
                description: "応援メッセージの配列を返す",
                input_schema: TEXT_RESPONSE_SCHEMA,
              },
            ],
            tool_choice: { type: "tool", name: RESPONSE_TOOL_NAME },
            // シナリオ: Anthropic はシードを受け付けない [境界]
            // Messages API に seed は存在しないため request.seed は送らない。
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as { content?: AnthropicContentBlock[] };
        // text 要素(前置きなど)は読まない。tool_use が無ければ形式違反として throw する
        const toolUse = (data.content ?? []).find((block) => block.type === "tool_use");
        return requireTextResponseMessages(toolUse?.input, "anthropic");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
