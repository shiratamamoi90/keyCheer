import { describe, it, expect, vi } from "vitest";
import { createOpenAITextGenerator } from "../../src/agent/providers/openaiText.js";

// spec: changes/0003-external-api-providers/spec.md / specs/integrations.md
//   外部テキストプロバイダー(OpenAI)。HTTP 契約 + 自動リトライしない(C6)。
// API キー・fetch は注入。キーはヘッダにのみ乗り、レスポンス解析は行を分割して返す。

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const chatResponse = {
  choices: [{ message: { content: "がんばれ!\nいい調子!\nその調子!" } }],
};

describe("openai-text / 呼び出し契約", () => {
  it("POSTs /v1/chat/completions with bearer auth and model", async () => {
    const fetchFn = vi.fn(async () => okJson(chatResponse));
    const gen = createOpenAITextGenerator({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetchFn,
    });
    const messages = await gen.generateMessages({
      systemPrompt: "you are a cheerer",
      scenarioKey: "fast_regular_evening",
      count: 3,
      timeoutMs: 10_000,
    });

    expect(gen.id).toBe("openai");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].content).toContain("you are a cheerer");
    expect(messages).toEqual(["がんばれ!", "いい調子!", "その調子!"]);
  });
});

describe("openai-text / 再現性のためのシード", () => {
  it("forwards request.seed when the caller pins it (再現性を保つ)", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "あ" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const gen = createOpenAITextGenerator({ apiKey: "sk", model: "gpt-4o-mini", fetchFn });
    await gen.generateMessages({
      systemPrompt: "p",
      scenarioKey: "slow_regular_night",
      count: 1,
      seed: 42,
      timeoutMs: 1000,
    });
    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { seed?: number };
    expect(body.seed).toBe(42);
  });

  it("omits seed when the caller does not pin one", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "あ" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const gen = createOpenAITextGenerator({ apiKey: "sk", model: "gpt-4o-mini", fetchFn });
    await gen.generateMessages({
      systemPrompt: "p",
      scenarioKey: "slow_regular_night",
      count: 1,
      timeoutMs: 1000,
    });
    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect("seed" in body).toBe(false);
  });
});

describe("openai-text / 失敗時は自動リトライしない [異常系]", () => {
  it("通信失敗・プロキシ環境 [異常系]: rejects on connection failure, called exactly once (自動リトライしない)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const gen = createOpenAITextGenerator({ apiKey: "sk", model: "gpt-4o-mini", fetchFn });
    await expect(
      gen.generateMessages({
        systemPrompt: "p",
        scenarioKey: "slow_regular_morning",
        count: 20,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects on 401 without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const gen = createOpenAITextGenerator({ apiKey: "bad", model: "gpt-4o-mini", fetchFn });
    await expect(
      gen.generateMessages({
        systemPrompt: "p",
        scenarioKey: "slow_regular_morning",
        count: 20,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
