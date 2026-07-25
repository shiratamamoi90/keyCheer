// ローカルプロバイダーの送信先が localhost に閉じていることを縛る。
// spec: specs/integrations.md「ローカル選択時は外部送信が発生しない [不変条件]」
// 決定的に検証できるのは「どこへ requests を出すか」。実際のネットワーク遮断は環境側の話なので、
// ここでは注入した fetch が受け取った URL のホストだけを検査する。

import { describe, it, expect } from "vitest";
import { createOllamaTextGenerator } from "../../src/agent/providers/localOllama.js";
import { createVoicevoxSynthesizer } from "../../src/agent/providers/localVoicevox.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

describe("providers / ローカル選択時は外部送信が発生しない [不変条件]", () => {
  it("keeps every request of the local text + voice providers on localhost", async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ response: "がんばれ" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const text = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "gemma2:2b",
      fetchFn,
    });
    await text.generateMessages({
      systemPrompt: "p",
      scenarioKey: "fast_regular_evening",
      count: 1,
      timeoutMs: 1000,
    });

    const voice = createVoicevoxSynthesizer({ endpoint: "http://127.0.0.1:50021", fetchFn });
    await voice.synthesize({ text: "がんばれ", timeoutMs: 1000 });

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(LOCAL_HOSTS.has(new URL(url).hostname)).toBe(true);
    }
  });
});
