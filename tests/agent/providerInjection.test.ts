import { describe, it, expect, vi, afterEach } from "vitest";
import { createOllamaTextGenerator } from "../../src/agent/providers/localOllama.js";
import { createVoicevoxSynthesizer } from "../../src/agent/providers/localVoicevox.js";

// 要件: docs/integrations.md(実 API を叩かずにテストできる [不変条件])
//
// 「テストが実際に通信しない」ことは、各テストの書き方に任せると保証にならない
// (1つでも注入を忘れると本物に飛ぶ)。ここでは **global fetch を必ず失敗させた状態**で
// HTTP で呼ぶプロバイダーを1回ずつ呼び、注入した fetch だけが使われることを確かめる。

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function forbidGlobalFetch(): void {
  globalThis.fetch = (() => {
    throw new Error("実際に通信しようとした(fetch が注入されていない)");
  }) as typeof fetch;
}

/** どちらのプロバイダーにも通る最小の成功応答。中身は各契約テスト側で縛る。 */
function fakeFetch() {
  const fn = vi.fn(async () =>
    Response.json({ response: JSON.stringify({ messages: ["がんばれ!"] }) }),
  );
  return fn as unknown as typeof fetch & typeof fn;
}

describe("providers / 実 API を叩かずにテストできる", () => {
  it("S0016_13 HTTP で呼ぶプロバイダーが注入した fetch だけを使う(global fetch には触れない)", async () => {
    forbidGlobalFetch();

    const textFetch = fakeFetch();
    const text = createOllamaTextGenerator({
      endpoint: "http://localhost:11434",
      model: "sarashina2.2-3b-instruct",
      fetchFn: textFetch,
    });
    await text
      .generateMessages({
        systemPrompt: "s",
        scenarioKey: "fast_regular_evening",
        count: 1,
        seed: 42,
        timeoutMs: 10_000,
      })
      .catch(() => undefined); // 応答の形は各契約テストの担当。ここでは経路だけを見る
    expect(textFetch).toHaveBeenCalled();

    const voiceFetch = fakeFetch();
    const voice = createVoicevoxSynthesizer({
      endpoint: "http://localhost:50021",
      fetchFn: voiceFetch,
    });
    await voice.synthesize({ text: "がんばれ!", timeoutMs: 10_000 }).catch(() => undefined);
    expect(voiceFetch).toHaveBeenCalled();
  });
});
