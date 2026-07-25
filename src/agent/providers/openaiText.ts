// openai-text: TextGenerator の外部実装(OpenAI Chat Completions)。キャラ作成時のみ・明示同意後に呼ばれる。
// spec: changes/0003-external-api-providers/spec.md / specs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは Authorization ヘッダにのみ乗せる。

import type { TextGenerator, TextGenerationRequest } from "../../engine/providers/types.js";

export interface OpenAITextConfig {
  apiKey: string;
  model: string; // 例: "gpt-4o-mini"
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]\s*|[-*・]\s*)/, "").trim();
}

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
          choices?: { message?: { content?: string } }[];
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        return content
          .split("\n")
          .map(stripBullet)
          .filter((l) => l.length > 0);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
