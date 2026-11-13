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

describe("localSdcpp / 枚数ぶん起動 + 同一シード(画像タグは呼び出し側。論点 0036)", () => {
  it("spawns once per image with the same seed and the prompt as-is", async () => {
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
    // 固定の表情タグ(旧 通常/喜び/激励)を足さない
    const prompts = spawned.map((s) => s.args[s.args.indexOf("-p") + 1]!);
    expect(prompts).toEqual(["anime girl", "anime girl", "anime girl"]);
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

// --- ローカル画像生成の作り方(論点 0045 / 0046)---

function runWith(
  over: Record<string, unknown>,
  written: { path: string; bytes: Uint8Array }[] = [],
) {
  const spawned: string[][] = [];
  const spawn: SpawnLike = (_cmd, args) => {
    const child = makeChild();
    spawned.push(args);
    queueMicrotask(() => child.fireClose(0));
    return child;
  };
  const generator = createSdcppImageGenerator({
    ...baseConfig(spawn, () => new Uint8Array([1])),
    makeInputPath: (i: number) => `sd-in-${i}.png`,
    writeInput: (path: string, bytes: Uint8Array) => {
      written.push({ path, bytes });
    },
  });
  return generator.generateImages({ ...request, count: 1, ...over }).then(() => spawned);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

describe("localSdcpp / 背景の色の語と避ける語を渡さない [否定]", () => {
  it("S0046_04 passes no negative prompt and adds no word to the prompt", async () => {
    // GIVEN providers.image = local-sdcpp
    // WHEN 下絵つき・下絵なしの引数を組み立てる
    const withInit = await runWith({ initImage: new Uint8Array([9]), strength: 0.9, steps: 4 });
    const plain = await runWith({});

    // THEN 避ける語の引数が無く、プロンプトは渡されたものそのまま(背景の色の語を足さない)
    for (const args of [...withInit, ...plain]) {
      expect(args).not.toContain("-n");
      expect(args).not.toContain("--negative-prompt");
      expect(valueAfter(args, "-p")).toBe("anime girl");
    }
  });
});

describe("localSdcpp / どの画像もサンプラー lcm・CFG 1・512x768・同じシードで作る", () => {
  it("S0046_05 passes lcm, CFG 1, the size, the seed and the LoRA for every image", async () => {
    // GIVEN providers.image = local-sdcpp
    // WHEN 待機画像(下地から)と応援種別の画像(待機画像から)を同じシードで生成する
    const idle = await runWith({
      seed: 777,
      initImage: new Uint8Array([9]),
      strength: 0.9,
      steps: 4,
    });
    const derived = await runWith({
      seed: 777,
      initImage: new Uint8Array([1]),
      strength: 0.65,
      steps: 8,
    });

    // THEN どちらもサンプラー lcm・CFG 1・512x768・同じ seed・LoRA の置き場を渡す
    for (const args of [...idle, ...derived]) {
      expect(valueAfter(args, "--sampling-method")).toBe("lcm");
      expect(valueAfter(args, "--cfg-scale")).toBe("1");
      expect(valueAfter(args, "-W")).toBe("512");
      expect(valueAfter(args, "-H")).toBe("768");
      expect(valueAfter(args, "-s")).toBe("777");
      expect(valueAfter(args, "--lora-model-dir")).toBe("/opt/sd/lcm.safetensors");
    }
  });
});

describe("localSdcpp / 下絵・強さ・ステップ数", () => {
  it("writes the init image to a file and passes it with the strength and the steps", async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const [args] = await runWith(
      { initImage: new Uint8Array([9, 9]), strength: 0.65, steps: 8 },
      written,
    );

    expect(written).toEqual([{ path: "sd-in-0.png", bytes: new Uint8Array([9, 9]) }]);
    expect(valueAfter(args!, "--init-img")).toBe("sd-in-0.png");
    expect(valueAfter(args!, "--strength")).toBe("0.65");
    expect(valueAfter(args!, "--steps")).toBe("8");
    expect(args!.filter((arg) => arg === "--steps")).toHaveLength(1);
  });

  it("passes no init image and the configured steps when the request has none", async () => {
    const [args] = await runWith({});

    expect(args).not.toContain("--init-img");
    expect(args).not.toContain("--strength");
    expect(valueAfter(args!, "--steps")).toBe("4");
  });
});

describe("localSdcpp / 一時ファイルを残さない", () => {
  function setup(exitCode: number) {
    const removed: string[] = [];
    const spawn: SpawnLike = () => {
      const child = makeChild();
      queueMicrotask(() => child.fireClose(exitCode));
      return child;
    };
    const generator = createSdcppImageGenerator({
      ...baseConfig(spawn, () => new Uint8Array([1])),
      makeInputPath: (i: number) => `sd-in-${i}.png`,
      writeInput: () => {},
      removeFile: (path: string) => {
        removed.push(path);
      },
    });
    const run = generator.generateImages({
      ...request,
      count: 1,
      initImage: new Uint8Array([9]),
      strength: 0.65,
      steps: 8,
    });
    return { removed, run };
  }

  it("removes the init image and the output after the image is read", async () => {
    const { removed, run } = setup(0);

    await run;

    expect(removed.slice().sort()).toEqual(["sd-in-0.png", "sd-out-0.png"]);
  });

  it("removes them also when sd.cpp fails", async () => {
    const { removed, run } = setup(1);

    await expect(run).rejects.toThrow();

    expect(removed.slice().sort()).toEqual(["sd-in-0.png", "sd-out-0.png"]);
  });
});
