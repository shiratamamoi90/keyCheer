import { describe, it, expect, vi } from "vitest";
import { createOllamaTextGenerator } from "../../src/agent/providers/localOllama.js";

// spec: specs/integrations.md(Ollama ローカルの呼び出し契約 / 未起動のフォールバック /
//        自動リトライしない C6)/ decisions/0002-local-llm-ollama.md
// fetch は注入し、HTTP 契約(URL・メソッド・ボディ)を決定的に検査する。

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("local-ollama / 呼び出し契約", () => {
  it("POSTs /api/generate with model, prompt, stream:false and seed option", async () => {
    const fetchFn = vi.fn(async () => okJson({ response: "がんばれ!\nいい調子!" }));
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

  it("strips bullet/numbering prefixes and empty lines from the response", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ response: "1. その調子!\n2) がんばって!\n- ナイス!\n\n・すごい!\n" }),
    );
    const gen = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "gemma2:2b",
      fetchFn,
    });
    const messages = await gen.generateMessages({
      systemPrompt: "p",
      scenarioKey: "slow_regular_morning",
      count: 4,
      timeoutMs: 5_000,
    });
    expect(messages).toEqual(["その調子!", "がんばって!", "ナイス!", "すごい!"]);
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
