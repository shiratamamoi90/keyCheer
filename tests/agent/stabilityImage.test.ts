import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createStabilityImageGenerator,
  resolveAspectRatio,
  STABILITY_ASPECT_RATIOS,
} from "../../src/agent/providers/stabilityImage.js";

// spec: changes/0009-additional-external-providers/spec.md
//   Stability AI(v2beta stable-image core)による ImageGenerator 実装。
//   1 リクエスト 1 枚のため count 回呼ぶ。width/height は受け付けず aspect_ratio へ写像する。

function okImage(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

const baseRequest = {
  prompt: "anime girl, cheerful",
  seed: 12345,
  count: 3,
  width: 512,
  height: 768,
  timeoutMs: 60_000,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("stability-image / 画像生成の呼び出し契約", () => {
  it("POSTs multipart/form-data to the core endpoint with bearer auth and accept image/*", async () => {
    const fetchFn = vi.fn(async () => okImage([137, 80, 78, 71]));
    const gen = createStabilityImageGenerator({ apiKey: "sk-stab", fetchFn });

    const images = await gen.generateImages(baseRequest);

    expect(gen.id).toBe("stability-ai");
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stability.ai/v2beta/stable-image/generate/core");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-stab");
    // accept: image/* で生バイト列を受け取る(application/json だと base64 になる)
    expect(headers["accept"]).toBe("image/*");

    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("prompt")).toBe("anime girl, cheerful");
    expect(form.get("seed")).toBe("12345");

    expect(images).toHaveLength(3);
    expect(Array.from(images[0]!)).toEqual([137, 80, 78, 71]);
  });

  it("calls the API once per requested image (1 リクエスト 1 枚)", async () => {
    const fetchFn = vi.fn(async () => okImage([1]));
    const gen = createStabilityImageGenerator({ apiKey: "sk", fetchFn });

    await gen.generateImages({ ...baseRequest, count: 3 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe("stability-image / 同一シードで再現する", () => {
  it("sends the same seed for every expression variant", async () => {
    const fetchFn = vi.fn(async () => okImage([1]));
    const gen = createStabilityImageGenerator({ apiKey: "sk", fetchFn });

    await gen.generateImages({ ...baseRequest, seed: 777, count: 3 });

    const seeds = fetchFn.mock.calls.map((call) => {
      const [, init] = call as unknown as [string, RequestInit];
      return (init.body as FormData).get("seed");
    });
    expect(seeds).toEqual(["777", "777", "777"]);
  });
});

describe("stability-image / width/height をアスペクト比へ写像する [境界]", () => {
  it("maps the default 512x768 to 2:3 exactly", () => {
    expect(resolveAspectRatio(512, 768)).toBe("2:3");
  });

  it("maps a square request to 1:1", () => {
    expect(resolveAspectRatio(1024, 1024)).toBe("1:1");
  });

  it("picks the numerically closest allowed ratio when there is no exact match", () => {
    // 500x760 ≒ 0.658。2:3 (0.667) が最も近い
    expect(resolveAspectRatio(500, 760)).toBe("2:3");
  });

  it("only ever returns a value from the allowed list", () => {
    for (const [w, h] of [
      [512, 768],
      [1024, 1024],
      [1920, 1080],
      [100, 900],
    ]) {
      expect(STABILITY_ASPECT_RATIOS).toContain(resolveAspectRatio(w!, h!));
    }
  });

  it("sends the resolved aspect_ratio instead of width/height", async () => {
    const fetchFn = vi.fn(async () => okImage([1]));
    const gen = createStabilityImageGenerator({ apiKey: "sk", fetchFn });

    await gen.generateImages({ ...baseRequest, count: 1 });

    const [, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("aspect_ratio")).toBe("2:3");
    expect(form.get("width")).toBeNull();
    expect(form.get("height")).toBeNull();
  });
});

describe("stability-image / 解決できないサイズはエラーにする [異常系]", () => {
  it("throws for a non-positive dimension instead of silently picking a size", () => {
    expect(() => resolveAspectRatio(0, 768)).toThrow();
    expect(() => resolveAspectRatio(512, -1)).toThrow();
  });

  it("rejects the generation when dimensions cannot be resolved", async () => {
    const fetchFn = vi.fn(async () => okImage([1]));
    const gen = createStabilityImageGenerator({ apiKey: "sk", fetchFn });

    await expect(gen.generateImages({ ...baseRequest, width: 0 })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("stability-image / API キーはヘッダにのみ乗る [不変条件]", () => {
  it("never puts the key in the url or the form body", async () => {
    const fetchFn = vi.fn(async () => okImage([1]));
    const gen = createStabilityImageGenerator({ apiKey: "sk-secret", fetchFn });

    await gen.generateImages({ ...baseRequest, count: 1 });

    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).not.toContain("sk-secret");
    const form = init.body as FormData;
    for (const key of ["prompt", "seed", "aspect_ratio", "output_format"]) {
      expect(String(form.get(key) ?? "")).not.toContain("sk-secret");
    }
  });
});

describe("stability-image / HTTP エラーは throw する [異常系]", () => {
  it("rejects on 500 and stops issuing further requests", async () => {
    const fetchFn = vi.fn(async () => new Response("boom", { status: 500 }));
    const gen = createStabilityImageGenerator({ apiKey: "sk", fetchFn });

    await expect(gen.generateImages(baseRequest)).rejects.toThrow(/500/);
    // 1 枚目で失敗したら残りは投げない(自動リトライも継続もしない)
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("stability-image / タイムアウト予算を超えたら中断する [境界]", () => {
  it("aborts the in-flight request once timeoutMs elapses", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const gen = createStabilityImageGenerator({
      apiKey: "sk",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const pending = gen.generateImages({ ...baseRequest, count: 1, timeoutMs: 30_000 });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
