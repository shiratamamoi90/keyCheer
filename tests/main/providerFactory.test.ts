// main/providerFactory: 選択された ProviderId から実際の生成器を組み立てる。
// spec: specs/integrations.md「MVP 実装セット(確定)」/「生成元プロバイダーの保存」
//
// 「どのモデルを使うか」は確定事項(2026-07-26)により**プロバイダーごとに固定**し
// UI から選ばせない。ここがその固定値の置き場。
// 実 API は叩かない — 組み立てだけを縛る(生成の中身は各 provider のテストが持つ)。

import { describe, it, expect } from "vitest";
import {
  createTextGeneratorFor,
  createVoiceSynthesizerFor,
} from "../../src/main/providerFactory.js";
import { DEFAULT_SYSTEM_CONFIG } from "../../src/shared/types.js";

const deps = {
  system: DEFAULT_SYSTEM_CONFIG,
  apiKeyFor: () => "sk-test",
  voiceIdFor: () => "voice-test",
};

describe("providerFactory / MVP 実装セット(確定)", () => {
  it("builds a text generator for every text provider id", () => {
    for (const id of ["local-ollama", "openai", "anthropic"] as const) {
      const result = createTextGeneratorFor(id, deps);
      expect(result.ok, id).toBe(true);
      if (result.ok) expect(typeof result.generator.generateMessages).toBe("function");
    }
  });

  it("builds a voice synthesizer for every voice provider id", () => {
    for (const id of ["local-voicevox", "openai-tts", "elevenlabs"] as const) {
      const result = createVoiceSynthesizerFor(id, deps);
      expect(result.ok, id).toBe(true);
      if (result.ok) expect(typeof result.synthesizer.synthesize).toBe("function");
    }
  });
});

describe("providerFactory / APIキー未設定で外部プロバイダーを選んだ場合 [異常系]", () => {
  it("refuses to build an external provider without its api key", () => {
    // キー無しで組み立ててしまうと、送信段階まで失敗が遅れる。
    const noKey = { ...deps, apiKeyFor: () => null };
    for (const id of ["openai", "anthropic"] as const) {
      const result = createTextGeneratorFor(id, noKey);
      expect(result.ok, id).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing-api-key");
    }
  });

  it("still builds local providers without any api key [不変条件]", () => {
    // ローカルはキー不要。ここが崩れるとオフライン既定が壊れる。
    const noKey = { ...deps, apiKeyFor: () => null };
    expect(createTextGeneratorFor("local-ollama", noKey).ok).toBe(true);
    expect(createVoiceSynthesizerFor("local-voicevox", noKey).ok).toBe(true);
  });
});

describe("providerFactory / ElevenLabs の voice ID 未設定", () => {
  it("refuses to build elevenlabs when no voice id is configured [要確認]", () => {
    // voice ID は 0009 で未確定のまま(声質の好みの判断)。
    // 既定値を勝手に置くと、ユーザーの意図しない声で全文を合成してしまう。
    const noVoice = { ...deps, voiceIdFor: () => null };
    const result = createVoiceSynthesizerFor("elevenlabs", noVoice);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("voice-id-required");
  });

  it("does not block the other voice providers on a missing voice id", () => {
    const noVoice = { ...deps, voiceIdFor: () => null };
    expect(createVoiceSynthesizerFor("local-voicevox", noVoice).ok).toBe(true);
    expect(createVoiceSynthesizerFor("openai-tts", noVoice).ok).toBe(true);
  });
});
