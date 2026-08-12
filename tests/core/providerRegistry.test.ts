import { describe, it, expect } from "vitest";
import {
  isTextProviderId,
  isVoiceProviderId,
  isImageProviderId,
  isLocalProvider,
  validateProviderSelection,
} from "../../src/core/providers/registry.js";

// spec: 論点 0016 / docs/integrations.md

describe("providers / プロバイダー一覧の契約 [境界]", () => {
  it("accepts every id in the closed union for its kind", () => {
    // text: "local-ollama" | "openai" | "anthropic"
    for (const id of ["local-ollama", "openai", "anthropic"]) {
      expect(isTextProviderId(id), `text: ${id}`).toBe(true);
    }
    // voice: "local-voicevox" | "openai-tts" | "elevenlabs"
    for (const id of ["local-voicevox", "openai-tts", "elevenlabs"]) {
      expect(isVoiceProviderId(id), `voice: ${id}`).toBe(true);
    }
    // image: "local-sdcpp" | "openai-dalle" | "stability-ai"
    for (const id of ["local-sdcpp", "openai-dalle", "stability-ai"]) {
      expect(isImageProviderId(id), `image: ${id}`).toBe(true);
    }
  });

  it("rejects ids of a different kind (kind-safety)", () => {
    expect(isTextProviderId("local-voicevox")).toBe(false);
    expect(isVoiceProviderId("openai")).toBe(false);
    expect(isImageProviderId("anthropic")).toBe(false);
  });

  it("rejects unknown / malformed identifiers", () => {
    for (const bad of ["gpt-4", "", "OPENAI", "local-", null, undefined, 123, {}]) {
      expect(isTextProviderId(bad), String(bad)).toBe(false);
      expect(isVoiceProviderId(bad), String(bad)).toBe(false);
      expect(isImageProviderId(bad), String(bad)).toBe(false);
    }
  });

  it("validates a full provider selection object", () => {
    const ok = validateProviderSelection({
      text: "openai",
      voice: "local-voicevox",
      image: "local-sdcpp",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value).toEqual({
        text: "openai",
        voice: "local-voicevox",
        image: "local-sdcpp",
      });
    }
  });

  it("rejects selection with unknown id or missing key", () => {
    const badId = validateProviderSelection({
      text: "gpt-4",
      voice: "local-voicevox",
      image: "local-sdcpp",
    });
    expect(badId.ok).toBe(false);

    const missing = validateProviderSelection({ text: "openai" });
    expect(missing.ok).toBe(false);

    expect(validateProviderSelection(null).ok).toBe(false);
    expect(validateProviderSelection("openai").ok).toBe(false);
  });
});

describe("providers / ローカル・外部の区別", () => {
  it("classifies local-* providers as local", () => {
    for (const id of ["local-ollama", "local-voicevox", "local-sdcpp"]) {
      expect(isLocalProvider(id), id).toBe(true);
    }
  });

  it("classifies external providers as non-local", () => {
    for (const id of [
      "openai",
      "anthropic",
      "openai-tts",
      "elevenlabs",
      "openai-dalle",
      "stability-ai",
    ]) {
      expect(isLocalProvider(id), id).toBe(false);
    }
  });
});
