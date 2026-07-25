import { describe, it, expect, vi } from "vitest";
import { createVoicevoxSynthesizer } from "../../src/agent/providers/localVoicevox.js";

// spec: specs/integrations.md「VOICEVOX (ローカル) の呼び出し契約」
//   POST /audio_query?text=...&speaker=ID → POST /synthesis?speaker=ID → wav
// 「VOICEVOX 未起動のフォールバック [異常系]」/ 自動リトライしない(C6)

const WAV_BYTES = new Uint8Array([82, 73, 70, 70, 0, 1]); // "RIFF"...

function makeFetchMock() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/audio_query")) {
      return new Response(JSON.stringify({ accent_phrases: [], speedScale: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/synthesis")) {
      return new Response(WAV_BYTES.buffer.slice(0), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("local-voicevox / 呼び出し契約", () => {
  it("calls audio_query then synthesis with encoded text and speaker id, returns wav bytes", async () => {
    const fetchFn = makeFetchMock();
    const synth = createVoicevoxSynthesizer({
      endpoint: "http://localhost:50021",
      fetchFn,
    });
    const wav = await synth.synthesize({
      text: "おはよう、ゆっくりでいいよ",
      speakerId: 3,
      timeoutMs: 5_000,
    });

    expect(synth.id).toBe("local-voicevox");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [queryUrl, queryInit] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(queryUrl).toBe(
      `http://localhost:50021/audio_query?text=${encodeURIComponent(
        "おはよう、ゆっくりでいいよ",
      )}&speaker=3`,
    );
    expect(queryInit.method).toBe("POST");

    const [synthUrl, synthInit] = fetchFn.mock.calls[1]! as unknown as [string, RequestInit];
    expect(synthUrl).toBe("http://localhost:50021/synthesis?speaker=3");
    expect(synthInit.method).toBe("POST");
    // synthesis のボディは audio_query の JSON をそのまま渡す
    expect(JSON.parse(synthInit.body as string)).toEqual({ accent_phrases: [], speedScale: 1 });

    expect(wav).toBeInstanceOf(Uint8Array);
    expect([...wav.slice(0, 4)]).toEqual([82, 73, 70, 70]);
  });
});

describe("local-voicevox / 未起動のフォールバック [異常系]", () => {
  it("rejects on connection failure without retrying", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:50021");
    });
    const synth = createVoicevoxSynthesizer({ endpoint: "http://localhost:50021", fetchFn });
    await expect(
      synth.synthesize({ text: "こんにちは", speakerId: 3, timeoutMs: 5_000 }),
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1); // audio_query で失敗 → そこで終了(リトライなし)
  });

  it("rejects when audio_query returns non-ok status (synthesis is not called)", async () => {
    const fetchFn = vi.fn(async () => new Response("bad speaker", { status: 422 }));
    const synth = createVoicevoxSynthesizer({ endpoint: "http://localhost:50021", fetchFn });
    await expect(
      synth.synthesize({ text: "x", speakerId: 9999, timeoutMs: 5_000 }),
    ).rejects.toThrow(/422/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
