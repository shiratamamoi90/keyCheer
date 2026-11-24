import { describe, it, expect } from "vitest";
import {
  isTextProviderId,
  isVoiceProviderId,
  isImageProviderId,
} from "../../src/core/providers/registry.js";

// spec: docs/integrations.md「プロバイダー識別子(閉じた union)」(論点 0054 でローカルだけになった)

describe("providers / プロバイダー識別子", () => {
  it("accepts the one local id of each kind", () => {
    expect(isTextProviderId("local-ollama")).toBe(true);
    expect(isVoiceProviderId("local-voicevox")).toBe(true);
    expect(isImageProviderId("local-sdcpp")).toBe(true);
  });

  it("rejects ids of a different kind (kind-safety)", () => {
    expect(isTextProviderId("local-voicevox")).toBe(false);
    expect(isVoiceProviderId("local-sdcpp")).toBe(false);
    expect(isImageProviderId("local-ollama")).toBe(false);
  });

  it("rejects the removed external ids and malformed identifiers", () => {
    for (const bad of [
      "openai",
      "anthropic",
      "openai-tts",
      "elevenlabs",
      "openai-dalle",
      "stability-ai",
    ]) {
      expect(isTextProviderId(bad) || isVoiceProviderId(bad) || isImageProviderId(bad), bad).toBe(
        false,
      );
    }
    for (const bad of ["", "local-", null, undefined, 123, {}]) {
      expect(isTextProviderId(bad), String(bad)).toBe(false);
      expect(isVoiceProviderId(bad), String(bad)).toBe(false);
      expect(isImageProviderId(bad), String(bad)).toBe(false);
    }
  });
});
