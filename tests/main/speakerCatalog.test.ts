// main/speakerCatalog: VOICEVOX から話者一覧を取得する。
// spec: 論点 0019
// fetch は注入。実サーバーを叩かない。通信先が localhost に閉じていることも縛る。

import { describe, it, expect, vi } from "vitest";
import { fetchSpeakers, DEFAULT_VOICEVOX_ENDPOINT } from "../../src/main/speakerCatalog.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// VOICEVOX /speakers は話者ごとに styles の配列を返す
const speakersResponse = [
  { name: "四国めたん", speaker_uuid: "uuid-1", styles: [{ name: "ノーマル", id: 2 }] },
  {
    name: "ずんだもん",
    speaker_uuid: "uuid-2",
    styles: [
      { name: "ノーマル", id: 3 },
      { name: "あまあま", id: 1 },
    ],
  },
];

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("speakerCatalog / 話者一覧を VOICEVOX から取得する", () => {
  it("S0019_05 flattens speakers and styles into selectable entries", async () => {
    const fetchFn = vi.fn(async () => okJson(speakersResponse));

    const result = await fetchSpeakers({ fetchFn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speakers).toEqual([
      { id: 2, name: "四国めたん", styleName: "ノーマル" },
      { id: 3, name: "ずんだもん", styleName: "ノーマル" },
      { id: 1, name: "ずんだもん", styleName: "あまあま" },
    ]);
  });

  it("requests the /speakers endpoint", async () => {
    const fetchFn = vi.fn(async () => okJson(speakersResponse));

    await fetchSpeakers({ fetchFn });

    const [url] = fetchFn.mock.calls[0]! as unknown as [string];
    expect(url).toBe(`${DEFAULT_VOICEVOX_ENDPOINT}/speakers`);
  });
});

describe("speakerCatalog / VOICEVOX 未起動でも画面は壊れない [異常系]", () => {
  it("S0019_06 returns unavailable instead of throwing when the connection fails", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(fetchSpeakers({ fetchFn })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns unavailable on a non-200 response", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));

    await expect(fetchSpeakers({ fetchFn })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns unavailable when the payload is not the expected shape", async () => {
    const fetchFn = vi.fn(async () => okJson({ unexpected: true }));

    await expect(fetchSpeakers({ fetchFn })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("speakerCatalog / 話者一覧の取得は localhost に閉じる [不変条件]", () => {
  it("S0019_07 only ever talks to localhost", async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return okJson(speakersResponse);
    }) as unknown as typeof fetch;

    await fetchSpeakers({ fetchFn });

    expect(urls).toHaveLength(1);
    for (const url of urls) {
      expect(LOCAL_HOSTS.has(new URL(url).hostname)).toBe(true);
    }
  });

  it("uses a localhost default endpoint", () => {
    expect(LOCAL_HOSTS.has(new URL(DEFAULT_VOICEVOX_ENDPOINT).hostname)).toBe(true);
  });
});
