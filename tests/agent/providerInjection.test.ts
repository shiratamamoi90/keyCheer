import { describe, it, expect, vi, afterEach } from "vitest";
import { createOllamaTextGenerator } from "../../src/agent/providers/localOllama.js";
import { createOpenAITextGenerator } from "../../src/agent/providers/openaiText.js";
import { createAnthropicTextGenerator } from "../../src/agent/providers/anthropicText.js";
import { createVoicevoxSynthesizer } from "../../src/agent/providers/localVoicevox.js";
import { createOpenAITTSSynthesizer } from "../../src/agent/providers/openaiTts.js";
import { createElevenLabsSynthesizer } from "../../src/agent/providers/elevenLabsTts.js";
import { createOpenAIDalleGenerator } from "../../src/agent/providers/openaiDalle.js";
import { createStabilityImageGenerator } from "../../src/agent/providers/stabilityImage.js";

// 要件: docs/integrations.md(実 API を叩かずにテストできる [不変条件])
//
// 「テストが実 API を叩かない」ことは、各テストの書き方に任せると保証にならない
// (1つでも注入を忘れると本物に飛ぶ)。ここでは **global fetch を必ず失敗させた状態**で
// 全プロバイダーを1回ずつ呼び、注入した fetch だけが使われることを確かめる。

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function forbidGlobalFetch(): void {
  globalThis.fetch = (() => {
    throw new Error("実 API を叩こうとした(fetch が注入されていない)");
  }) as typeof fetch;
}

/** どのプロバイダーにも通る最小の成功応答。中身は各契約テスト側で縛る。 */
function fakeFetch() {
  const fn = vi.fn(async () =>
    Response.json({
      response: "がんばれ!",
      content: [{ text: "がんばれ!" }],
      choices: [{ message: { content: "がんばれ!" } }],
      artifacts: [{ base64: "" }],
      data: [{ b64_json: "" }],
    }),
  );
  // 各プロバイダーの config は `typeof fetch` を要求する。呼び出し検査のため mock の型も残す。
  return fn as unknown as typeof fetch & typeof fn;
}

describe("providers / 実 API を叩かずにテストできる", () => {
  it("S0016_13 全プロバイダーが注入した fetch だけを使う(global fetch には触れない)", async () => {
    forbidGlobalFetch();
    const calls: string[] = [];

    const build = (name: string) => {
      const fetchFn = fakeFetch();
      calls.push(name);
      return { fetchFn, name };
    };

    const text = [
      (() => {
        const { fetchFn } = build("local-ollama");
        return {
          fetchFn,
          gen: createOllamaTextGenerator({
            endpoint: "http://localhost:11434",
            model: "gemma2:2b",
            fetchFn,
          }),
        };
      })(),
      (() => {
        const { fetchFn } = build("openai");
        return {
          fetchFn,
          gen: createOpenAITextGenerator({ apiKey: "k", model: "gpt-4o-mini", fetchFn }),
        };
      })(),
      (() => {
        const { fetchFn } = build("anthropic");
        return {
          fetchFn,
          gen: createAnthropicTextGenerator({ apiKey: "k", model: "claude-sonnet-5", fetchFn }),
        };
      })(),
    ];

    for (const { fetchFn, gen } of text) {
      await gen
        .generateMessages({
          systemPrompt: "s",
          scenarioKey: "fast_regular_evening",
          count: 1,
          seed: 42,
          timeoutMs: 10_000,
        })
        .catch(() => undefined); // 応答の形は各契約テストの担当。ここでは経路だけを見る
      expect(fetchFn).toHaveBeenCalled();
    }

    const voice = [
      (() => {
        const { fetchFn } = build("local-voicevox");
        return {
          fetchFn,
          syn: createVoicevoxSynthesizer({
            endpoint: "http://localhost:50021",
            fetchFn,
          }),
        };
      })(),
      (() => {
        const { fetchFn } = build("openai-tts");
        return {
          fetchFn,
          syn: createOpenAITTSSynthesizer({ apiKey: "k", model: "tts-1", voice: "alloy", fetchFn }),
        };
      })(),
      (() => {
        const { fetchFn } = build("elevenlabs");
        return {
          fetchFn,
          syn: createElevenLabsSynthesizer({ apiKey: "k", defaultVoiceId: "v", fetchFn }),
        };
      })(),
    ];

    for (const { fetchFn, syn } of voice) {
      await syn.synthesize({ text: "がんばれ!", timeoutMs: 10_000 }).catch(() => undefined);
      expect(fetchFn).toHaveBeenCalled();
    }

    const image = [
      (() => {
        const { fetchFn } = build("openai-dalle");
        return {
          fetchFn,
          gen: createOpenAIDalleGenerator({ apiKey: "k", model: "dall-e-3", fetchFn }),
        };
      })(),
      (() => {
        const { fetchFn } = build("stability-ai");
        return {
          fetchFn,
          gen: createStabilityImageGenerator({ apiKey: "k", fetchFn }),
        };
      })(),
    ];

    for (const { fetchFn, gen } of image) {
      await gen
        .generateImages({
          prompt: "cheerful character",
          seed: 42,
          count: 1,
          width: 512,
          height: 512,
          timeoutMs: 10_000,
        })
        .catch(() => undefined);
      expect(fetchFn).toHaveBeenCalled();
    }

    // 8 プロバイダー全部を通した(sd.cpp は子プロセスなので通信プロバイダーに含めない)
    expect(calls).toHaveLength(8);
  });
});
