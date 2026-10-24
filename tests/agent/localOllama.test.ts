import { describe, it, expect, vi } from "vitest";
import { createOllamaTextGenerator } from "../../src/agent/providers/localOllama.js";

// 要件: docs/integrations.md(Ollama ローカルの呼び出し契約 / 未起動のフォールバック /
//        自動リトライしない C6)/ decisions/0002-local-llm-ollama.md
// fetch は注入し、HTTP 契約(URL・メソッド・ボディ)を決定的に検査する。

// 応答スキーマ(docs/integrations.md「テキスト応答のパース契約」の写し。実装の定数から導かない)
const RESPONSE_SCHEMA = {
  type: "object",
  properties: { messages: { type: "array", items: { type: "string" } } },
  required: ["messages"],
  additionalProperties: false,
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("local-ollama / 呼び出し契約", () => {
  it("POSTs /api/generate with model, prompt, stream:false and seed option", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ response: JSON.stringify({ messages: ["がんばれ!", "いい調子!"] }) }),
    );
    const gen = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "gemma2:2b",
      fetchFn,
    });
    const messages = await gen.generateMessages({
      systemPrompt: "system prompt here",
      scenarioKey: "fast_regular_evening",
      count: 2,
      seed: 42,
      timeoutMs: 5_000,
    });

    expect(gen.id).toBe("local-ollama");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/generate");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gemma2:2b");
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain("system prompt here");
    expect(body.options.seed).toBe(42); // 再現性: シード固定(impl-rules.md)
    expect(messages).toEqual(["がんばれ!", "いい調子!"]);
  });

  it("S0024_01 requests the response schema through format", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ response: JSON.stringify({ messages: ["がんばれ!"] }) }),
    );
    const gen = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "gemma2:2b",
      fetchFn,
    });
    await gen.generateMessages({
      systemPrompt: "p",
      scenarioKey: "slow_regular_morning",
      count: 1,
      timeoutMs: 5_000,
    });

    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.format).toEqual(RESPONSE_SCHEMA);
  });

  it("rejects a response that does not follow the schema (行分割に退避しない)", async () => {
    const fetchFn = vi.fn(async () => okJson({ response: "がんばれ!\nいい調子!" }));
    const gen = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "gemma2:2b",
      fetchFn,
    });
    await expect(
      gen.generateMessages({
        systemPrompt: "p",
        scenarioKey: "slow_regular_morning",
        count: 2,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("local-ollama / 未起動のフォールバック [異常系]", () => {
  it("rejects on connection failure without retrying (called exactly once)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const gen = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "gemma2:2b",
      fetchFn,
    });
    await expect(
      gen.generateMessages({
        systemPrompt: "p",
        scenarioKey: "slow_regular_morning",
        count: 20,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1); // 自動リトライしない(C6)
  });

  it("rejects on non-ok HTTP status without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("model not found", { status: 404 }));
    const gen = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "nope",
      fetchFn,
    });
    await expect(
      gen.generateMessages({
        systemPrompt: "p",
        scenarioKey: "slow_regular_morning",
        count: 20,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/404/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
