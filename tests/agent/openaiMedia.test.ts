import { describe, it, expect, vi } from "vitest";
import { createOpenAITTSSynthesizer } from "../../src/agent/providers/openaiTts.js";
import { createOpenAIDalleGenerator } from "../../src/agent/providers/openaiDalle.js";

// spec: changes/0003-external-api-providers/spec.md / specs/integrations.md(外部音声・画像)
//   OpenAI TTS (/v1/audio/speech) と DALL-E (/v1/images/generations)。
//   バイナリ返却、bearer 認証、自動リトライしない(C6)。

const WAV = new Uint8Array([82, 73, 70, 70, 1, 2]);
const IMG = new Uint8Array([137, 80, 78, 71]); // PNG magic

describe("openai-tts / 呼び出し契約", () => {
  it("POSTs /v1/audio/speech with bearer auth and returns audio bytes", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(WAV.buffer.slice(0), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
    );
    const synth = createOpenAITTSSynthesizer({
      apiKey: "sk-test",
      model: "tts-1",
      voice: "alloy",
      fetchFn,
    });
    const bytes = await synth.synthesize({ text: "おはよう", timeoutMs: 10_000 });

    expect(synth.id).toBe("openai-tts");
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("tts-1");
    expect(body.voice).toBe("alloy");
    expect(body.input).toBe("おはよう");
    expect([...bytes.slice(0, 4)]).toEqual([82, 73, 70, 70]);
  });

  it("rejects on failure without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("err", { status: 500 }));
    const synth = createOpenAITTSSynthesizer({
      apiKey: "sk",
      model: "tts-1",
      voice: "alloy",
      fetchFn,
    });
    await expect(synth.synthesize({ text: "x", timeoutMs: 10_000 })).rejects.toThrow(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("openai-dalle / 呼び出し契約", () => {
  it("requests N images at the given size and returns decoded bytes (b64_json)", async () => {
    const b64 = Buffer.from(IMG).toString("base64");
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const gen = createOpenAIDalleGenerator({ apiKey: "sk-test", model: "dall-e-3", fetchFn });
    const images = await gen.generateImages({
      prompt: "anime girl",
      seed: 42,
      count: 2,
      width: 1024,
      height: 1024,
      timeoutMs: 60_000,
    });

    expect(gen.id).toBe("openai-dalle");
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.size).toBe("1024x1024");
    expect(body.response_format).toBe("b64_json");
    expect(images).toHaveLength(2);
    expect([...images[0]!.slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });

  // spec: specs/integrations.md「3 枚生成して終了」/「通常/喜び/激励の 3 枚を表情タグ差し替えで生成」
  it("3 枚生成して終了: requests one image per expression tag (通常/喜び/激励)", async () => {
    const b64 = Buffer.from(IMG).toString("base64");
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const gen = createOpenAIDalleGenerator({ apiKey: "sk-test", model: "dall-e-3", fetchFn });
    const images = await gen.generateImages({
      prompt: "anime girl",
      seed: 42,
      count: 3,
      width: 1024,
      height: 1024,
      timeoutMs: 60_000,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    const prompts = calls.map((c) => JSON.parse(c[1].body as string).prompt as string);
    // 3 枚とも同じベースプロンプト + 別々の表情タグ(ローカル sd.cpp と同じ 3 表情)
    expect(prompts.every((p) => p.startsWith("anime girl, "))).toBe(true);
    expect(new Set(prompts).size).toBe(3);
    // 1 リクエスト = 1 枚(dall-e-3 は n=1 のみ受け付ける)
    for (const call of calls) {
      expect(JSON.parse(call[1].body as string).n).toBe(1);
    }
    expect(images).toHaveLength(3);
  });

  it("rejects on failure without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("bad", { status: 400 }));
    const gen = createOpenAIDalleGenerator({ apiKey: "sk", model: "dall-e-3", fetchFn });
    await expect(
      gen.generateImages({
        prompt: "x",
        seed: 1,
        count: 1,
        width: 512,
        height: 512,
        timeoutMs: 60_000,
      }),
    ).rejects.toThrow(/400/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
