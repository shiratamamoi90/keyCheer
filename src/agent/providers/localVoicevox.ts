// local-voicevox: VoiceSynthesizer のローカル実装(VOICEVOX HTTP :50021)。キャラ作成時のみ呼ばれる。
// spec: specs/integrations.md「VOICEVOX (ローカル) の呼び出し契約」
//   POST /audio_query?text=...&speaker=ID → POST /synthesis?speaker=ID → wav
// 失敗時は throw(自動リトライしない C6)。呼び出し側(voiceSynth)が部分失敗を許容する。

import type { VoiceSynthesizer, VoiceSynthesisRequest } from "../../engine/providers/types.js";

export interface VoicevoxConfig {
  endpoint: string; // 例: "http://localhost:50021"(system.voicevoxEndpoint)
  fetchFn?: typeof fetch;
}

const DEFAULT_SPEAKER_ID = 3;

export function createVoicevoxSynthesizer(config: VoicevoxConfig): VoiceSynthesizer {
  const { endpoint, fetchFn = fetch } = config;
  return {
    id: "local-voicevox",
    async synthesize(request: VoiceSynthesisRequest): Promise<Uint8Array> {
      const speaker = request.speakerId ?? DEFAULT_SPEAKER_ID;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const queryRes = await fetchFn(
          `${endpoint}/audio_query?text=${encodeURIComponent(request.text)}&speaker=${speaker}`,
          { method: "POST", signal: controller.signal },
        );
        if (!queryRes.ok) {
          throw new Error(`VOICEVOX audio_query HTTP ${queryRes.status}: ${await queryRes.text()}`);
        }
        const query = await queryRes.json();

        const synthRes = await fetchFn(`${endpoint}/synthesis?speaker=${speaker}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(query),
          signal: controller.signal,
        });
        if (!synthRes.ok) {
          throw new Error(`VOICEVOX synthesis HTTP ${synthRes.status}: ${await synthRes.text()}`);
        }
        return new Uint8Array(await synthRes.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
