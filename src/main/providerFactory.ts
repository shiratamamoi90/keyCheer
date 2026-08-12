// providerFactory: 選択された ProviderId から実際の生成器を組み立てる。
// 要件: docs/integrations.md「MVP 実装セット(確定)」
//
// **このモジュールと characterCreationIpc だけが providers を import する。**
// index.ts(発動経路の配線)には混ぜない — 発動経路は外部依存ゼロという不変条件を
// コードの構造としても保つため(eslint.config.js の mainCheerPathRestrictedPatterns)。
//
// 「どのモデルを使うか」は確定事項(2026-07-26)により**プロバイダーごとに固定**し
// UI から選ばせない。その固定値はここに置く。
// API キー本体は safeStorage 管轄(src/agent/secrets.ts)。ここは注入で受け取るだけで保持しない。

import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import { createVoicevoxSynthesizer } from "../agent/providers/localVoicevox.js";
import { createOpenAITextGenerator } from "../agent/providers/openaiText.js";
import { createAnthropicTextGenerator } from "../agent/providers/anthropicText.js";
import { createOpenAITTSSynthesizer } from "../agent/providers/openaiTts.js";
import { createElevenLabsSynthesizer } from "../agent/providers/elevenLabsTts.js";
import type { TextGenerator, VoiceSynthesizer } from "../core/providers/types.js";
import type {
  ProviderId,
  SystemConfig,
  TextProviderId,
  VoiceProviderId,
} from "../core/shared/types.js";

// プロバイダーごとに固定するモデル。UI からは選ばせない(2026-07-26 確定)。
const OPENAI_TEXT_MODEL = "gpt-4o-mini";
const ANTHROPIC_TEXT_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_TTS_MODEL = "tts-1";
const OPENAI_TTS_VOICE = "alloy";

export interface ProviderFactoryDeps {
  system: SystemConfig;
  /** キーが無ければ null。値そのものはここで保持しない。 */
  apiKeyFor: (id: ProviderId) => string | null;
  /** ElevenLabs の voice ID。未設定なら null(0009 で未確定のまま)。 */
  voiceIdFor: (id: ProviderId) => string | null;
}

export type BuildFailure = "missing-api-key" | "voice-id-required";

export type TextGeneratorResult =
  | { ok: true; generator: TextGenerator }
  | { ok: false; reason: BuildFailure };

export type VoiceSynthesizerResult =
  | { ok: true; synthesizer: VoiceSynthesizer }
  | { ok: false; reason: BuildFailure };

export function createTextGeneratorFor(
  id: TextProviderId,
  deps: ProviderFactoryDeps,
): TextGeneratorResult {
  // シナリオ: ローカル選択時は外部送信が発生しない [不変条件] — キー無しでも必ず組める
  if (id === "local-ollama") {
    return {
      ok: true,
      generator: createOllamaTextGenerator({
        endpoint: deps.system.ollamaEndpoint,
        model: deps.system.ollamaModel,
      }),
    };
  }

  // シナリオ: APIキー未設定で外部プロバイダーを選んだ場合 [異常系]
  // キー無しで組み立てると失敗が送信段階まで遅れる。組み立て時点で断る。
  const apiKey = deps.apiKeyFor(id);
  if (apiKey === null) return { ok: false, reason: "missing-api-key" };

  if (id === "openai") {
    return { ok: true, generator: createOpenAITextGenerator({ apiKey, model: OPENAI_TEXT_MODEL }) };
  }
  return {
    ok: true,
    generator: createAnthropicTextGenerator({ apiKey, model: ANTHROPIC_TEXT_MODEL }),
  };
}

export function createVoiceSynthesizerFor(
  id: VoiceProviderId,
  deps: ProviderFactoryDeps,
): VoiceSynthesizerResult {
  if (id === "local-voicevox") {
    return {
      ok: true,
      synthesizer: createVoicevoxSynthesizer({ endpoint: deps.system.voicevoxEndpoint }),
    };
  }

  const apiKey = deps.apiKeyFor(id);
  if (apiKey === null) return { ok: false, reason: "missing-api-key" };

  if (id === "openai-tts") {
    return {
      ok: true,
      synthesizer: createOpenAITTSSynthesizer({
        apiKey,
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
      }),
    };
  }

  // [要確認] ElevenLabs の voice ID は 0009 で未確定のまま(声質の好みの判断)。
  // 既定値を勝手に置くと、ユーザーの意図しない声でプール全文を合成してしまう。
  // 決まるまでは「組み立てない」= 生成に進ませない、で倒す。
  const voiceId = deps.voiceIdFor(id);
  if (voiceId === null) return { ok: false, reason: "voice-id-required" };

  return {
    ok: true,
    synthesizer: createElevenLabsSynthesizer({ apiKey, defaultVoiceId: voiceId }),
  };
}
