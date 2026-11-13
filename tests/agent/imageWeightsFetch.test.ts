// agent/imageWeightsFetch: 画像の重みの取得(進捗・中断・続きから・照合・空き容量)。
// 要件: docs/model-weights.md(論点 0042)
// 通信とファイルは偽物。実際の取得元には繋がない。

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  fetchImageWeights,
  type WeightDownload,
  type WeightPartStore,
} from "../../src/agent/imageWeightsFetch.js";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const CONTENT_A = Uint8Array.from({ length: 10 }, (_, i) => i + 1);
const CONTENT_B = Uint8Array.from({ length: 6 }, (_, i) => 100 + i);

function downloads(): WeightDownload[] {
  return [
    {
      url: "https://example.test/a",
      destPath: "/w/a.bin",
      sha256: sha256(CONTENT_A),
      byteSize: 10,
    },
    { url: "https://example.test/b", destPath: "/w/b.bin", sha256: sha256(CONTENT_B), byteSize: 6 },
  ];
}

function memoryStore(freeBytes = 1_000_000) {
  const parts: Record<string, number[]> = {};
  const files: Record<string, number[]> = {};
  const store: WeightPartStore = {
    exists: (path) => path in files,
    partSize: (path) => parts[path]?.length ?? 0,
    appendPart: (path, chunk) => {
      (parts[path] ??= []).push(...chunk);
    },
    resetPart: (path) => {
      delete parts[path];
    },
    hashPart: async (path) => sha256(Uint8Array.from(parts[path] ?? [])),
    commitPart: (path) => {
      files[path] = parts[path] ?? [];
      delete parts[path];
    },
    freeBytes: () => freeBytes,
  };
  return { store, parts, files };
}

// 取得元の偽物。Range があれば続きを 206 で、無ければ全部を 200 で、3 バイトずつ返す
function fakeServer(contents: Record<string, Uint8Array>) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const body = contents[url];
    if (body === undefined) throw new Error("ECONNREFUSED");
    const range = new Headers(init?.headers).get("range");
    const start = range === null ? 0 : Number(/bytes=(\d+)-/.exec(range)![1]);
    const rest = body.subarray(start);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < rest.length; i += 3) controller.enqueue(rest.subarray(i, i + 3));
        controller.close();
      },
    });
    return new Response(stream, { status: range === null ? 200 : 206 });
  }) as typeof fetch;
  return { fetchFn, requests };
}

const SERVER = { "https://example.test/a": CONTENT_A, "https://example.test/b": CONTENT_B };

describe("imageWeightsFetch / 取得中は進捗を示し、中断できる", () => {
  it("S0042_03 reports the fetched and total bytes, and keeps what was fetched when cancelled", async () => {
    // GIVEN 重みの取得中
    const { store, parts, files } = memoryStore();
    const { fetchFn } = fakeServer(SERVER);
    const progress: [number, number][] = [];

    // WHEN 利用者が進捗を見て、6 バイトを超えたところで中断する
    const result = await fetchImageWeights({
      files: downloads(),
      store,
      fetchFn,
      onProgress: (done, total) => progress.push([done, total]),
      shouldCancel: () => (progress.at(-1)?.[0] ?? 0) >= 6,
    });

    // THEN 取得済みの量と全体の量が示される。中断すると通信を止め、それまでに取得した分は残す
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(progress.every(([, total]) => total === 16)).toBe(true);
    expect(progress.map(([done]) => done)).toEqual([3, 6]);
    expect(parts["/w/a.bin"]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(files).toEqual({});
  });
});

describe("imageWeightsFetch / 中断・通信断のあとは続きから取得する", () => {
  it("S0042_04 requests only the rest and completes both files", async () => {
    // GIVEN 取得が途中で中断され、6 バイトが残っている
    const { store, parts, files } = memoryStore();
    parts["/w/a.bin"] = [1, 2, 3, 4, 5, 6];
    const { fetchFn, requests } = fakeServer(SERVER);

    // WHEN 利用者が取得をもう一度始める
    const result = await fetchImageWeights({ files: downloads(), store, fetchFn });

    // THEN 残っている分の続きから取得し、最初から取り直さない
    expect(result).toEqual({ ok: true });
    expect(new Headers(requests[0]!.init?.headers).get("range")).toBe("bytes=6-");
    expect(files["/w/a.bin"]).toEqual([...CONTENT_A]);
    expect(files["/w/b.bin"]).toEqual([...CONTENT_B]);
    expect(parts).toEqual({});
  });

  it("skips a file that is already in place", async () => {
    const { store, files } = memoryStore();
    files["/w/a.bin"] = [...CONTENT_A];
    const { fetchFn, requests } = fakeServer(SERVER);

    const result = await fetchImageWeights({ files: downloads(), store, fetchFn });

    expect(result).toEqual({ ok: true });
    expect(requests.map((r) => r.url)).toEqual(["https://example.test/b"]);
  });

  it("returns network when the source cannot be reached and keeps the part", async () => {
    const { store, parts } = memoryStore();
    parts["/w/a.bin"] = [1, 2, 3];
    const { fetchFn } = fakeServer({});

    const result = await fetchImageWeights({ files: downloads(), store, fetchFn });

    expect(result).toEqual({ ok: false, reason: "network" });
    expect(parts["/w/a.bin"]).toEqual([1, 2, 3]);
  });
});

describe("imageWeightsFetch / ハッシュが一致しなければ使わない [異常系]", () => {
  it("S0042_05 does not put a file in place when its sha256 differs", async () => {
    // GIVEN 取得が最後まで終わったが、sha256 が決められた値と一致しない
    const { store, parts, files } = memoryStore();
    const tampered = { ...SERVER, "https://example.test/a": Uint8Array.from(CONTENT_A).fill(9) };
    const { fetchFn } = fakeServer(tampered);

    // WHEN 取得した重みを照合する
    const result = await fetchImageWeights({ files: downloads(), store, fetchFn });

    // THEN その重みを使わず、取得されていない状態のままにする(取り直せるよう、取得物は捨てる)
    expect(result).toEqual({ ok: false, reason: "hash-mismatch" });
    expect(files).toEqual({});
    expect(parts).toEqual({});
  });
});

describe("imageWeightsFetch / 空き容量が足りなければ取得を始めない [異常系]", () => {
  it("S0042_06 does not start and does not communicate when the free space is too small", async () => {
    // GIVEN 置き場の空き容量が、取得する重みのサイズより小さい
    const { store } = memoryStore(15);
    const { fetchFn, requests } = fakeServer(SERVER);

    // WHEN 利用者が取得を始める
    const result = await fetchImageWeights({ files: downloads(), store, fetchFn });

    // THEN 取得を始めず、通信は発生しない
    expect(result).toEqual({ ok: false, reason: "insufficient-space" });
    expect(requests).toEqual([]);
  });
});

describe("imageWeightsFetch / 取得で利用者の情報を送らず、監査ログにも記録しない [否定]", () => {
  it("S0042_12 sends nothing but a plain GET for the file", async () => {
    // GIVEN 重みの取得
    const { store, parts } = memoryStore();
    parts["/w/a.bin"] = [1, 2, 3];
    const { fetchFn, requests } = fakeServer(SERVER);

    // WHEN 取得元と通信する
    await fetchImageWeights({ files: downloads(), store, fetchFn });

    // THEN 送るのは重みを受け取るための要求だけ(本文なし。ヘッダーは続きを取るための Range だけ)
    expect(requests.map((r) => r.url)).toEqual([
      "https://example.test/a",
      "https://example.test/b",
    ]);
    for (const { init } of requests) {
      expect(init?.body).toBeUndefined();
      expect(init?.method ?? "GET").toBe("GET");
      const headerNames: string[] = [];
      new Headers(init?.headers).forEach((_value, key) => headerNames.push(key));
      expect(headerNames.filter((key) => key !== "range")).toEqual([]);
    }
  });
});
