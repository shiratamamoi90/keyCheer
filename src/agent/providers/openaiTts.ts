// openai-tts: VoiceSynthesizer の外部実装(OpenAI TTS /v1/audio/speech)。
// spec: 論点 0016 / docs/integrations.md
// 失敗時は throw(自動リトライしない C6)。キャラ作成時のみ・明示同意後に呼ばれる。

import type { VoiceSynthesizer, VoiceSynthesisRequest } from "../../core/providers/types.js";

export interface OpenAITTSConfig {
  apiKey: string;
  model: string; // 例: "tts-1"
  voice: string; // 例: "alloy"
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/audio/speech";

export function createOpenAITTSSynthesizer(config: OpenAITTSConfig): VoiceSynthesizer {
  const { apiKey, model, voice, endpoint = DEFAULT_ENDPOINT, fetchFn = fetch } = config;
  return {
    id: "openai-tts",
    async synthesize(request: VoiceSynthesisRequest): Promise<Uint8Array> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, voice, input: request.text, response_format: "wav" }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`OpenAI TTS HTTP ${res.status}: ${await res.text()}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
