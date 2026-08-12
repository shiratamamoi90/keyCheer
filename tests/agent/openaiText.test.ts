import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenAITextGenerator } from "../../src/agent/providers/openaiText.js";

// spec: 論点 0016 / docs/integrations.md
//   外部テキストプロバイダー(OpenAI)。HTTP 契約 + 自動リトライしない(C6)。
// API キー・fetch は注入。キーはヘッダにのみ乗り、レスポンス解析は行を分割して返す。
// docs/integrations.md「共通: 外部プロバイダー呼び出しの契約」は種別を問わず全実装が満たす。

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const chatResponse = {
  choices: [{ message: { content: "がんばれ!\nいい調子!\nその調子!" } }],
};

const baseRequest = {
  systemPrompt: "you are a cheerer",
  scenarioKey: "fast_regular_evening",
  count: 3,
  timeoutMs: 10_000,
};

afterEach(() => {
  vi.useRealTimers();
});

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

describe("openai-text / HTTP エラーは throw する [異常系]", () => {
  it("S0016_07 通信失敗・プロキシ環境 [異常系]: rejects on connection failure, called exactly once (自動リトライしない)", async () => {
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

describe("openai-text / API キーは認証ヘッダにのみ乗る [不変条件]", () => {
  it("puts the key in Authorization only, never in the url or body", async () => {
    const fetchFn = vi.fn(async () => okJson(chatResponse));
    const gen = createOpenAITextGenerator({
      apiKey: "sk-openai-secret",
      model: "gpt-4o-mini",
      fetchFn,
    });

    await gen.generateMessages(baseRequest);

    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-openai-secret");
    expect(url).not.toContain("sk-openai-secret");
    expect(init.body as string).not.toContain("sk-openai-secret");
  });
});

describe("openai-text / タイムアウト予算を超えたら中断する [境界]", () => {
  it("aborts the in-flight request once timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const gen = createOpenAITextGenerator({
      apiKey: "sk",
      model: "gpt-4o-mini",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const pending = gen.generateMessages({ ...baseRequest, timeoutMs: 5_000 });
    const assertion = expect(pending).rejects.toThrow(/aborted/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
});
