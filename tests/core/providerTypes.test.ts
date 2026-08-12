import { describe, it, expect } from "vitest";
import type {
  TextGenerator,
  VoiceSynthesizer,
  ImageGenerator,
} from "../../src/core/providers/types.js";

// spec: 論点 0016(生成手段の抽象化)/ docs/integrations.md
// インターフェースは型契約なので、fake 実装が型検査を通り想定通り呼べることを確認する。
// 予算(timeoutMs)・シードを引数で受ける anytime 設計(impl-rules.md)。

const fakeText: TextGenerator = {
  id: "local-ollama",
  generateMessages: async ({ count }) => Array.from({ length: count }, (_, i) => `msg${i}`),
};

const fakeVoice: VoiceSynthesizer = {
  id: "local-voicevox",
  synthesize: async () => new Uint8Array([82, 73, 70, 70]), // "RIFF"
};

const fakeImage: ImageGenerator = {
  id: "local-sdcpp",
  generateImages: async ({ count }) => Array.from({ length: count }, () => new Uint8Array(1)),
};

describe("providers / 生成インターフェース契約", () => {
  it("TextGenerator: id は閉じた union、count 件のメッセージを返す契約", async () => {
    const messages = await fakeText.generateMessages({
      systemPrompt: "you are a cheerer",
      scenarioKey: "fast_regular_evening",
      count: 20,
      seed: 42,
      timeoutMs: 5_000,
    });
    expect(fakeText.id).toBe("local-ollama");
    expect(messages).toHaveLength(20);
  });

  it("VoiceSynthesizer: テキスト 1 文 → wav バイト列の契約", async () => {
    const wav = await fakeVoice.synthesize({
      text: "おはよう",
      speakerId: 3,
      timeoutMs: 5_000,
    });
    expect(fakeVoice.id).toBe("local-voicevox");
    expect(wav).toBeInstanceOf(Uint8Array);
  });

  it("ImageGenerator: 同一シード指定で count 枚の画像バイト列を返す契約", async () => {
    const images = await fakeImage.generateImages({
      prompt: "anime girl, smiling",
      seed: 42,
      count: 3,
      width: 512,
      height: 768,
      timeoutMs: 60_000,
    });
    expect(fakeImage.id).toBe("local-sdcpp");
    expect(images).toHaveLength(3);
  });
});
