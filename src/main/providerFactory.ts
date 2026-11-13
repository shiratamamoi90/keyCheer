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
import { createOpenAIDalleGenerator } from "../agent/providers/openaiDalle.js";
import { createStabilityImageGenerator } from "../agent/providers/stabilityImage.js";
import { createSdcppImageGenerator, type SpawnLike } from "../agent/providers/localSdcpp.js";
import { hasSdcppFiles, type SdcppPaths } from "./bundledSdcpp.js";
import type {
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../core/providers/types.js";
import type {
  ImageProviderId,
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
const OPENAI_IMAGE_MODEL = "dall-e-3";

// 同梱した sd.cpp を動かすのに要るもの(論点 0040)。パスは同梱物の配置と重みの置き場から決めたものを受け取り、
// 設定(system)からは読まない(S0040_04)。子プロセスとファイルの I/O は main が渡す
export interface SdcppRuntimeDeps {
  paths: SdcppPaths;
  exists: (path: string) => boolean;
  spawn: SpawnLike;
  readOutput: (path: string) => Uint8Array;
  writeInput: (path: string, bytes: Uint8Array) => void;
  removeFile: (path: string) => void;
  tempDir: string; // sd.cpp の出力と下絵を置く一時の置き場
}

export interface ProviderFactoryDeps {
  system: SystemConfig;
  /** キーが無ければ null。値そのものはここで保持しない。 */
  apiKeyFor: (id: ProviderId) => string | null;
  /** ElevenLabs の voice ID。未設定なら null(0009 で未確定のまま)。 */
  voiceIdFor: (id: ProviderId) => string | null;
  /** 同梱した sd.cpp。渡さなければ local-sdcpp は組み立てない。 */
  sdcpp?: SdcppRuntimeDeps;
}

export type BuildFailure = "missing-api-key" | "voice-id-required";
// runtime-not-installed: sd.cpp の実行ファイルかモデル重みが置き場に無い(S0040_02)。
// 画像の失敗は生成を止めない(S0036_10)ので、文言・音声の BuildFailure とは別に持つ
export type ImageBuildFailure = "missing-api-key" | "runtime-not-installed";

// テキストプロバイダーは画像タグの要求も受け持つ(論点 0036)
export type TextGeneratorResult =
  | { ok: true; generator: TextGenerator & ImageTagGenerator }
  | { ok: false; reason: BuildFailure };

export type ImageGeneratorResult =
  | { ok: true; generator: ImageGenerator }
  | { ok: false; reason: ImageBuildFailure };

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

export function createImageGeneratorFor(
  id: ImageProviderId,
  deps: ProviderFactoryDeps,
): ImageGeneratorResult {
  if (id === "local-sdcpp") {
    // S0040_02 実行ファイルか重みが無ければ子プロセスを起動しない — 組み立てないので画像の工程に進まず、
    // 生成は画像なしで完了する(S0036_10)。重みは選んだ人だけが取得するので、無いのは普通の状態
    const sdcpp = deps.sdcpp;
    if (sdcpp === undefined || !hasSdcppFiles(sdcpp.paths, sdcpp.exists)) {
      return { ok: false, reason: "runtime-not-installed" };
    }
    // S0040_01 同梱した sd.cpp と重みが揃っていれば local-sdcpp で画像の工程を実行する
    return {
      ok: true,
      generator: createSdcppImageGenerator({
        binPath: sdcpp.paths.binPath,
        modelPath: sdcpp.paths.modelPath,
        loraPath: sdcpp.paths.loraDir,
        spawn: sdcpp.spawn,
        readOutput: sdcpp.readOutput,
        writeInput: sdcpp.writeInput,
        removeFile: sdcpp.removeFile,
        makeOutputPath: (index) => `${sdcpp.tempDir}/sd-out-${index}.png`,
        makeInputPath: (index) => `${sdcpp.tempDir}/sd-in-${index}.png`,
      }),
    };
  }

  const apiKey = deps.apiKeyFor(id);
  if (apiKey === null) return { ok: false, reason: "missing-api-key" };

  if (id === "openai-dalle") {
    return {
      ok: true,
      generator: createOpenAIDalleGenerator({ apiKey, model: OPENAI_IMAGE_MODEL }),
    };
  }
  return { ok: true, generator: createStabilityImageGenerator({ apiKey }) };
}
