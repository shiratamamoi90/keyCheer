import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createSdcppImageGenerator,
  type ChildHandleLike,
  type SpawnLike,
} from "../../src/agent/providers/localSdcpp.js";

// 要件: docs/integrations.md「画像 (sd.cpp / 外部)」
//   3 枚生成して終了 / 同一シードで再現 / タイムアウト・失敗時はプロセス終了(ゾンビ防止) /
//   子プロセスはタイムアウト・キャンセル・重複起動排他を持つ [不変条件]。
// spawn / readOutput は注入。実バイナリには触れず、引数・プロセス制御・出力読み出しを検査する。

afterEach(() => {
  vi.useRealTimers();
});

// スクリプト可能な fake 子プロセス。close/error をテストから発火させる。
function makeChild() {
  const handlers: Record<string, ((arg: unknown) => void)[]> = {};
  const child: ChildHandleLike & {
    fireClose: (code: number | null) => void;
    fireError: (err: Error) => void;
    kill: ReturnType<typeof vi.fn<(signal?: string) => void>>;
  } = {
    on(event: string, cb: (arg: never) => void) {
      (handlers[event] ??= []).push(cb as (arg: unknown) => void);
      return child;
    },
    kill: vi.fn(),
    fireClose: (code) => handlers["close"]?.forEach((h) => h(code)),
    fireError: (err) => handlers["error"]?.forEach((h) => h(err)),
  };
  return child;
}

const baseConfig = (spawn: SpawnLike, readOutput: (p: string) => Uint8Array) => ({
  binPath: "/opt/sd/sd",
  modelPath: "/opt/sd/anime.safetensors",
  loraPath: "/opt/sd/lcm.safetensors",
  spawn,
  readOutput,
});

const request = {
  prompt: "anime girl",
  seed: 42,
  count: 3,
  width: 512,
  height: 768,
  timeoutMs: 60_000,
};

describe("localSdcpp / 3 枚生成して終了 + 同一シード + 表情タグ", () => {
  it("spawns once per image with the same seed and distinct expression tags", async () => {
    const spawned: { args: string[] }[] = [];
    const spawn: SpawnLike = (_cmd, args) => {
      const child = makeChild();
      spawned.push({ args });
      // 非同期に成功終了(exit 0)
      queueMicrotask(() => child.fireClose(0));
      return child;
    };
    const readOutput = (p: string) => new Uint8Array([1, 2, 3, p.length]);
    const gen = createSdcppImageGenerator(baseConfig(spawn, readOutput));

    const images = await gen.generateImages(request);

    expect(gen.id).toBe("local-sdcpp");
    expect(images).toHaveLength(3);
    expect(spawned).toHaveLength(3);
    // 全て同一シード(-s 42)
    for (const s of spawned) {
      const seedIdx = s.args.indexOf("-s");
      expect(seedIdx).toBeGreaterThanOrEqual(0);
      expect(s.args[seedIdx + 1]).toBe("42");
    }
    // 表情タグは 3 枚で異なる(プロンプト末尾に付与)
    const prompts = spawned.map((s) => s.args[s.args.indexOf("-p") + 1]!);
    expect(new Set(prompts).size).toBe(3);
    for (const p of prompts) expect(p).toContain("anime girl");
    // steps=4 と model/lora が引数に乗る
    expect(spawned[0]!.args).toContain("--steps");
    expect(spawned[0]!.args).toContain("/opt/sd/anime.safetensors");
    expect(spawned[0]!.args).toContain("/opt/sd/lcm.safetensors");
  });

  it("is reproducible: same seed yields the same seed arg across runs", async () => {
    const seeds: string[] = [];
    const spawn: SpawnLike = (_cmd, args) => {
      const child = makeChild();
      seeds.push(args[args.indexOf("-s") + 1]!);
      queueMicrotask(() => child.fireClose(0));
      return child;
    };
    const gen = createSdcppImageGenerator(baseConfig(spawn, () => new Uint8Array([0])));
    await gen.generateImages({ ...request, count: 1 });
    await gen.generateImages({ ...request, count: 1 });
    expect(seeds).toEqual(["42", "42"]);
  });
});

describe("localSdcpp / 非ゼロ終了で失敗 [異常系]", () => {
  it("rejects when the process exits with a non-zero code", async () => {
    const spawn: SpawnLike = () => {
      const child = makeChild();
      queueMicrotask(() => child.fireClose(1));
      return child;
    };
    const gen = createSdcppImageGenerator(baseConfig(spawn, () => new Uint8Array([0])));
    await expect(gen.generateImages(request)).rejects.toThrow(/exit|code 1/i);
  });

  it("rejects on spawn error event", async () => {
    const spawn: SpawnLike = () => {
      const child = makeChild();
      queueMicrotask(() => child.fireError(new Error("ENOENT sd binary")));
      return child;
    };
    const gen = createSdcppImageGenerator(baseConfig(spawn, () => new Uint8Array([0])));
    await expect(gen.generateImages(request)).rejects.toThrow(/ENOENT/);
  });
});

describe("localSdcpp / タイムアウト/失敗時 [異常系] — プロセスを kill(ゾンビ防止)", () => {
  it("S0016_33 kills the child and rejects when it does not finish within timeoutMs", async () => {
    vi.useFakeTimers();
    const child = makeChild();
    const spawn: SpawnLike = () => child; // 決して close しない
    const gen = createSdcppImageGenerator(baseConfig(spawn, () => new Uint8Array([0])));

    const p = gen.generateImages({ ...request, count: 1, timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow(/timed out|timeout/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(child.kill).toHaveBeenCalled(); // ゾンビ防止のため kill する
  });
});

describe("localSdcpp / 重複起動排他 [不変条件]", () => {
  it("rejects a concurrent generateImages while one is in-flight", async () => {
    const children: ReturnType<typeof makeChild>[] = [];
    const spawn: SpawnLike = () => {
      const child = makeChild();
      children.push(child); // 手動で close する(自動終了しない)
      return child;
    };
    const gen = createSdcppImageGenerator(baseConfig(spawn, () => new Uint8Array([9])));

    const first = gen.generateImages({ ...request, count: 1 });
    // 1 枚目がまだ実行中に 2 回目を呼ぶ → 排他で即 reject
    await expect(gen.generateImages({ ...request, count: 1 })).rejects.toThrow(
      /already running|実行中|重複/i,
    );

    // 1 回目を完了させる
    children[0]!.fireClose(0);
    await expect(first).resolves.toHaveLength(1);

    // 完了後は再度実行できる(ロックが解放される)
    const child2 = makeChild();
    queueMicrotask(() => child2.fireClose(0));
    // ロック解放の確認: 直前の spawn を差し替えず、新しい呼び出しが排他に当たらないこと
    const third = gen.generateImages({ ...request, count: 1 });
    children[children.length - 1]!.fireClose(0);
    await expect(third).resolves.toBeDefined();
  });
});
