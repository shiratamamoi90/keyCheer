import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createElevenLabsSynthesizer,
  ELEVENLABS_DEFAULT_OUTPUT_FORMAT,
} from "../../src/agent/providers/elevenLabsTts.js";

// spec: changes/0009-additional-external-providers/spec.md
//   ElevenLabs TTS による VoiceSynthesizer 実装。
//   voice_id はパスパラメータ、認証は xi-api-key、output_format に wav_* を明示して wav を直接受け取る。

function okAudio(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

const baseRequest = { text: "がんばれ!", timeoutMs: 10_000 };

afterEach(() => {
  vi.useRealTimers();
});

describe("elevenlabs-tts / 音声合成の呼び出し契約", () => {
  it("POSTs to /v1/text-to-speech/{voice_id} with xi-api-key and the text body", async () => {
    const fetchFn = vi.fn(async () => okAudio([1, 2, 3]));
    const synth = createElevenLabsSynthesizer({
      apiKey: "xi-test",
      defaultVoiceId: "voice-default",
      fetchFn,
    });

    const wav = await synth.synthesize(baseRequest);

    expect(synth.id).toBe("elevenlabs");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("https://api.elevenlabs.io/v1/text-to-speech/voice-default");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // Bearer ではなく xi-api-key
    expect(headers["xi-api-key"]).toBe("xi-test");
    expect(headers["Authorization"]).toBeUndefined();

    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toBe("がんばれ!");
    expect(Array.from(wav)).toEqual([1, 2, 3]);
  });

  it("maps a numeric speakerId to a voice id through the injected table", async () => {
    const fetchFn = vi.fn(async () => okAudio([9]));
    const synth = createElevenLabsSynthesizer({
      apiKey: "xi",
      defaultVoiceId: "voice-default",
      voiceIdBySpeakerId: { 3: "voice-three" },
      fetchFn,
    });

    await synth.synthesize({ ...baseRequest, speakerId: 3 });

    const [url] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/voice-three");
  });

  it("falls back to the default voice id when the speaker is not in the table", async () => {
    const fetchFn = vi.fn(async () => okAudio([9]));
    const synth = createElevenLabsSynthesizer({
      apiKey: "xi",
      defaultVoiceId: "voice-default",
      voiceIdBySpeakerId: { 3: "voice-three" },
      fetchFn,
    });

    await synth.synthesize({ ...baseRequest, speakerId: 999 });

    const [url] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/voice-default");
  });
});

describe("elevenlabs-tts / 返る音声は wav である [不変条件]", () => {
  it("requests a wav output format explicitly (既定の mp3 に任せない)", async () => {
    const fetchFn = vi.fn(async () => okAudio([1]));
    const synth = createElevenLabsSynthesizer({
      apiKey: "xi",
      defaultVoiceId: "v",
      fetchFn,
    });

    await synth.synthesize(baseRequest);

    const [url] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain(`output_format=${ELEVENLABS_DEFAULT_OUTPUT_FORMAT}`);
    expect(ELEVENLABS_DEFAULT_OUTPUT_FORMAT).toMatch(/^wav_/);
  });

  it("does not default to a 44.1kHz format (Pro プラン契約が要るため)", () => {
    expect(ELEVENLABS_DEFAULT_OUTPUT_FORMAT).not.toBe("wav_44100");
  });

  it("returns the raw bytes as a Uint8Array", async () => {
    const fetchFn = vi.fn(async () => okAudio([82, 73, 70, 70]));
    const synth = createElevenLabsSynthesizer({ apiKey: "xi", defaultVoiceId: "v", fetchFn });

    const wav = await synth.synthesize(baseRequest);

    expect(wav).toBeInstanceOf(Uint8Array);
    expect(Array.from(wav)).toEqual([82, 73, 70, 70]);
  });
});

describe("elevenlabs-tts / API キーはヘッダにのみ乗る [不変条件]", () => {
  it("never puts the key in the url or the body", async () => {
    const fetchFn = vi.fn(async () => okAudio([1]));
    const synth = createElevenLabsSynthesizer({
      apiKey: "xi-secret",
      defaultVoiceId: "v",
      fetchFn,
    });

    await synth.synthesize(baseRequest);

    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).not.toContain("xi-secret");
    expect(init.body as string).not.toContain("xi-secret");
  });
});

describe("elevenlabs-tts / HTTP エラーは throw する [異常系]", () => {
  it("rejects on 422 without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response("unprocessable", { status: 422 }));
    const synth = createElevenLabsSynthesizer({ apiKey: "xi", defaultVoiceId: "v", fetchFn });

    await expect(synth.synthesize(baseRequest)).rejects.toThrow(/422/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("elevenlabs-tts / タイムアウト予算を超えたら中断する [境界]", () => {
  it("aborts the in-flight request once timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const synth = createElevenLabsSynthesizer({
      apiKey: "xi",
      defaultVoiceId: "v",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const pending = synth.synthesize({ ...baseRequest, timeoutMs: 3_000 });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });
});
