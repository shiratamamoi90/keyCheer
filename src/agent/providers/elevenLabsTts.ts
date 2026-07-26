// elevenlabs-tts: VoiceSynthesizer の外部実装(ElevenLabs Text to Speech)。
// spec: changes/0009-additional-external-providers/spec.md / specs/integrations.md
// 失敗時は throw(自動リトライしない C6)。API キーは xi-api-key ヘッダにのみ乗せる(Bearer ではない)。
// voice_id はパスパラメータ。数値の speakerId は注入されたテーブルで voice ID 文字列へ写像する。

import type { VoiceSynthesizer, VoiceSynthesisRequest } from "../../engine/providers/types.js";

export interface ElevenLabsTtsConfig {
  apiKey: string;
  defaultVoiceId: string;
  // シナリオ: 音声合成の呼び出し契約 — speakerId(数値)→ voice ID(文字列)の写像。
  // 採用する声は好みの判断のため、値は呼び出し側から注入する(コードに埋め込まない)。
  voiceIdBySpeakerId?: Record<number, string>;
  modelId?: string;
  outputFormat?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// シナリオ: 返る音声は wav である [不変条件]
// 既定応答は mp3 のため wav_* を明示指定する。wav_44100 は Pro 以上のプラン契約が必要なので使わない。
export const ELEVENLABS_DEFAULT_OUTPUT_FORMAT = "wav_22050";

export function createElevenLabsSynthesizer(config: ElevenLabsTtsConfig): VoiceSynthesizer {
  const {
    apiKey,
    defaultVoiceId,
    voiceIdBySpeakerId = {},
    modelId,
    outputFormat = ELEVENLABS_DEFAULT_OUTPUT_FORMAT,
    baseUrl = DEFAULT_BASE_URL,
    fetchFn = fetch,
  } = config;

  return {
    id: "elevenlabs",
    async synthesize(request: VoiceSynthesisRequest): Promise<Uint8Array> {
      const voiceId =
        request.speakerId !== undefined && voiceIdBySpeakerId[request.speakerId] !== undefined
          ? voiceIdBySpeakerId[request.speakerId]!
          : defaultVoiceId;

      const url = `${baseUrl}/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const res = await fetchFn(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify({
            text: request.text,
            ...(modelId !== undefined ? { model_id: modelId } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`ElevenLabs HTTP ${res.status}: ${await res.text()}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
