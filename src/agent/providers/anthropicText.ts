// anthropic-text: TextGenerator の外部実装(Anthropic Messages API)。キャラ作成時のみ・明示同意後に呼ばれる。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは x-api-key ヘッダにのみ乗せる。
// OpenAI 実装との構造差: systemPrompt はトップレベル system、messages には user ロールが必要、
// seed パラメータは存在しない。

import type { TextGenerator, TextGenerationRequest } from "../../core/providers/types.js";

export interface AnthropicTextConfig {
  apiKey: string;
  model: string; // 例: "claude-haiku-4-5-20251001"
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// シナリオ: max_tokens を要求量から決める [境界]
// 1 文 30 字以内(docs/integrations.md 文字数契約)× 日本語のトークン化係数 2 + 記号分の余裕。
// 実疎通での実測後に調整しうるが、調整しても入出力契約は変わらない。
export const ANTHROPIC_TOKENS_PER_MESSAGE = 64;
export const ANTHROPIC_MAX_TOKENS_MARGIN = 256;

export function computeMaxTokens(count: number): number {
  return count * ANTHROPIC_TOKENS_PER_MESSAGE + ANTHROPIC_MAX_TOKENS_MARGIN;
}

// openaiText と同じ規則(行頭の箇条書き記号・番号を除去)
function stripBullet(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]\s*|[-*・]\s*)/, "").trim();
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
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
                content: `${request.scenarioKey} の応援メッセージを ${request.count} 件、1 行 1 件で出力してください。`,
              },
            ],
            // シナリオ: Anthropic はシードを受け付けない [境界]
            // Messages API に seed は存在しないため request.seed は送らない。
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json()) as { content?: AnthropicContentBlock[] };
        const text = (data.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n");
        return text
          .split("\n")
          .map(stripBullet)
          .filter((l) => l.length > 0);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
