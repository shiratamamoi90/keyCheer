import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAnthropicTextGenerator,
  ANTHROPIC_TOKENS_PER_MESSAGE,
  ANTHROPIC_MAX_TOKENS_MARGIN,
} from "../../src/agent/providers/anthropicText.js";

// spec: changes/0009-additional-external-providers/spec.md
//   Anthropic Messages API による TextGenerator 実装。
//   systemPrompt はトップレベル system、messages には user ロールが必要(OpenAI と構造が違う)。

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const messagesResponse = {
  content: [{ type: "text", text: "がんばれ!\nいい調子!\nその調子!" }],
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

describe("anthropic-text / Anthropic (外部) の呼び出し契約", () => {
  it("POSTs /v1/messages with the documented headers and body shape", async () => {
    const fetchFn = vi.fn(async () => okJson(messagesResponse));
    const gen = createAnthropicTextGenerator({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5-20251001",
      fetchFn,
    });

    const messages = await gen.generateMessages(baseRequest);

    expect(gen.id).toBe("anthropic");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    // systemPrompt はトップレベル system に置く(messages の system ロールではない)
    expect(body.system).toContain("you are a cheerer");
    expect(body.messages.some((m) => m.role === "system")).toBe(false);
    // messages には最低 1 件の user ロールが要る
    expect(body.messages[0]!.role).toBe("user");
    expect(body.messages[0]!.content).toContain("fast_regular_evening");

    expect(messages).toEqual(["がんばれ!", "いい調子!", "その調子!"]);
  });

  it("concatenates only text blocks and strips bullets/blank lines", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        content: [
          { type: "thinking", thinking: "無視される" },
          { type: "text", text: "- がんばれ!\n\n1. いい調子!\n・その調子!" },
        ],
      }),
    );
    const gen = createAnthropicTextGenerator({ apiKey: "sk", model: "m", fetchFn });
    await expect(gen.generateMessages(baseRequest)).resolves.toEqual([
      "がんばれ!",
      "いい調子!",
      "その調子!",
    ]);
  });
});

describe("anthropic-text / Anthropic の max_tokens を要求量から決める [境界]", () => {
  it("computes max_tokens deterministically from count", async () => {
    const fetchFn = vi.fn(async () => okJson(messagesResponse));
    const gen = createAnthropicTextGenerator({ apiKey: "sk", model: "m", fetchFn });

    await gen.generateMessages({ ...baseRequest, count: 20 });

    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { max_tokens: number };
    expect(body.max_tokens).toBe(20 * ANTHROPIC_TOKENS_PER_MESSAGE + ANTHROPIC_MAX_TOKENS_MARGIN);
  });

  it("always sends max_tokens because the API requires it", async () => {
    const fetchFn = vi.fn(async () => okJson(messagesResponse));
    const gen = createAnthropicTextGenerator({ apiKey: "sk", model: "m", fetchFn });

    await gen.generateMessages({ ...baseRequest, count: 1 });

    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(typeof body.max_tokens).toBe("number");
    expect(body.max_tokens as number).toBeGreaterThan(0);
  });
});

describe("anthropic-text / Anthropic はシードを受け付けない [境界]", () => {
  it("never sends seed even when the caller pins one", async () => {
    const fetchFn = vi.fn(async () => okJson(messagesResponse));
    const gen = createAnthropicTextGenerator({ apiKey: "sk", model: "m", fetchFn });

    await gen.generateMessages({ ...baseRequest, seed: 42 });

    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect("seed" in body).toBe(false);
  });
});

describe("anthropic-text / API キーは認証ヘッダにのみ乗る [不変条件]", () => {
  it("puts the key in x-api-key only, never in the url or body", async () => {
    const fetchFn = vi.fn(async () => okJson(messagesResponse));
    const gen = createAnthropicTextGenerator({ apiKey: "sk-ant-secret", model: "m", fetchFn });

    await gen.generateMessages(baseRequest);

    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-secret");
    expect(url).not.toContain("sk-ant-secret");
    expect(init.body as string).not.toContain("sk-ant-secret");
  });
});

describe("anthropic-text / HTTP エラーは throw する [異常系]", () => {
  it("rejects on 401 without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const gen = createAnthropicTextGenerator({ apiKey: "bad", model: "m", fetchFn });

    await expect(gen.generateMessages(baseRequest)).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects on connection failure, called exactly once (自動リトライしない)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const gen = createAnthropicTextGenerator({ apiKey: "sk", model: "m", fetchFn });

    await expect(gen.generateMessages(baseRequest)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("anthropic-text / タイムアウト予算を超えたら中断する [境界]", () => {
  it("aborts the in-flight request once timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const gen = createAnthropicTextGenerator({
      apiKey: "sk",
      model: "m",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const pending = gen.generateMessages({ ...baseRequest, timeoutMs: 5_000 });
    const assertion = expect(pending).rejects.toThrow(/aborted/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
});
