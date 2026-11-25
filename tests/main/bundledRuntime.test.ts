// main/bundledRuntime: 同梱ランタイム(Ollama / VOICEVOX ENGINE)の起動と停止。
// 要件: docs/integrations.md「同梱ランタイムの起動と停止」(論点 0034)
// 子プロセス・HTTP・待ち時間は注入した偽物で置き換える(実物は起こさない)。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { createBundledRuntimeController, createNodeRuntimeSpawn, resolveBundledRuntimes } =
  await import("../../src/main/bundledRuntime.js");

const RESOURCES = "/app/resources";
const USER_DATA = "/userdata";
const OLLAMA_URL = "http://127.0.0.1:11434/api/version";
const VOICEVOX_URL = "http://127.0.0.1:50021/version";

interface FakeChild {
  command: string;
  killed: boolean;
  closeListeners: ((arg: unknown) => void)[];
}

// GIVEN の組み立て:responding = いま応答がある接続先。isReadyOnSpawn = 起動したら応答が出るか
function setup(
  options: {
    responding?: string[];
    hasFiles?: boolean;
    isReadyOnSpawn?: boolean;
  } = {},
) {
  const responding = new Set(options.responding ?? []);
  const children: FakeChild[] = [];
  const runtimes = resolveBundledRuntimes({
    resourcesDir: RESOURCES,
    userDataDir: USER_DATA,
    platform: "win32",
  });
  const controller = createBundledRuntimeController({
    runtimes,
    exists: () => options.hasFiles ?? true,
    spawn: (command) => {
      const child: FakeChild = { command, killed: false, closeListeners: [] };
      children.push(child);
      if (options.isReadyOnSpawn ?? true) {
        const runtime = runtimes.find((r) => r.binPath === command)!;
        responding.add(runtime.healthUrl);
      }
      return {
        on: (event, listener) => {
          if (event === "close") child.closeListeners.push(listener);
        },
        kill: () => {
          child.killed = true;
          const runtime = runtimes.find((r) => r.binPath === command)!;
          responding.delete(runtime.healthUrl);
        },
      };
    },
    isResponding: (url) => Promise.resolve(responding.has(url)),
    sleep: () => Promise.resolve(),
    startTimeoutMs: 1000,
    pollIntervalMs: 100,
  });
  // 落ちた:プロセスが消え、応答も無くなる
  const crash = (child: FakeChild): void => {
    const runtime = runtimes.find((r) => r.binPath === child.command)!;
    responding.delete(runtime.healthUrl);
    for (const listener of child.closeListeners) listener(1);
  };
  return { controller, children, responding, runtimes, crash };
}

const OLLAMA_BIN = `${RESOURCES}/ollama/ollama.exe`;
const VOICEVOX_BIN = `${RESOURCES}/voicevox/run.exe`;

describe("bundledRuntime / メインウィンドウを表示したとき、応答が無ければ同梱ランタイムを起動する", () => {
  it("S0034_01 starts both bundled runtimes and they respond afterwards", async () => {
    const { controller, children, responding } = setup();
    await controller.onMainWindowShown();
    expect(children.map((c) => c.command)).toEqual([OLLAMA_BIN, VOICEVOX_BIN]);
    expect(responding.has(OLLAMA_URL) && responding.has(VOICEVOX_URL)).toBe(true);
  });
});

describe("bundledRuntime / 既に応答があれば同梱ランタイムを起動しない [境界]", () => {
  it("S0034_02 starts only VOICEVOX ENGINE when Ollama already responds", async () => {
    const { controller, children } = setup({ responding: [OLLAMA_URL] });
    await controller.onMainWindowShown();
    expect(children.map((c) => c.command)).toEqual([VOICEVOX_BIN]);
  });
});

describe("bundledRuntime / メインウィンドウを隠したら、アプリが起動した同梱ランタイムを止める", () => {
  it("S0034_03 stops every runtime the app started when hidden and not generating", async () => {
    const { controller, children } = setup();
    await controller.onMainWindowShown();
    controller.onMainWindowHidden();
    expect(children.map((c) => c.killed)).toEqual([true, true]);
  });
});

describe("bundledRuntime / 生成中に隠しても、生成が終わるまで止めない [境界]", () => {
  it("S0034_04 keeps runtimes while generating and stops them when the generation ends hidden", async () => {
    const { controller, children } = setup();
    await controller.onMainWindowShown();
    await controller.beforeGeneration();
    controller.onMainWindowHidden();
    expect(children.some((c) => c.killed)).toBe(false);
    controller.onGenerationFinished();
    expect(children.map((c) => c.killed)).toEqual([true, true]);
  });
});

describe("bundledRuntime / アプリが起動していないものは止めない [否定]", () => {
  it("S0034_05 never starts or stops runtimes it found already responding", async () => {
    const { controller, children, responding } = setup({ responding: [OLLAMA_URL, VOICEVOX_URL] });
    await controller.onMainWindowShown();
    controller.onMainWindowHidden();
    controller.stopAll();
    expect(children).toEqual([]);
    expect(responding.has(OLLAMA_URL) && responding.has(VOICEVOX_URL)).toBe(true);
  });
});

describe("bundledRuntime / 起動待ちが時間上限を超えたら失敗として扱う [異常系]", () => {
  it("S0034_06 stops a runtime that does not respond within the time limit", async () => {
    const { controller, children } = setup({ isReadyOnSpawn: false });
    await controller.onMainWindowShown();
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.killed)).toEqual([true, true]);
  });
});

describe("bundledRuntime / 途中で落ちても自動で再起動しない [否定]", () => {
  it("S0034_07 does not start a crashed runtime again while the window stays shown", async () => {
    const { controller, children, crash } = setup();
    await controller.onMainWindowShown();
    crash(children[0]!);
    // 表示したまま時間が経つ(もう一度表示の通知が来ても、表示中の重ねた通知なので起動しない)
    await Promise.resolve();
    expect(children).toHaveLength(2);
  });
});

describe("bundledRuntime / 失敗のあと、次の表示・生成の開始で改めて起動を試みる", () => {
  it("S0034_08 tries again on the next show and on the start of a generation", async () => {
    const { controller, children, crash } = setup();
    await controller.onMainWindowShown();
    crash(children[0]!);
    // 生成の開始で、応答の無い Ollama だけを起動し直す
    await controller.beforeGeneration();
    expect(children.map((c) => c.command)).toEqual([OLLAMA_BIN, VOICEVOX_BIN, OLLAMA_BIN]);
    controller.onGenerationFinished();

    crash(children[2]!);
    controller.onMainWindowHidden();
    await controller.onMainWindowShown();
    expect(children.slice(3).map((c) => c.command)).toEqual([OLLAMA_BIN, VOICEVOX_BIN]);
  });
});

describe("bundledRuntime / アプリ終了時に、起動した同梱ランタイムを必ず止める", () => {
  it("S0034_09 stops every started runtime on quit, even while generating", async () => {
    const { controller, children } = setup();
    await controller.onMainWindowShown();
    await controller.beforeGeneration();
    controller.stopAll();
    expect(children.map((c) => c.killed)).toEqual([true, true]);
  });
});

describe("bundledRuntime / 応援の発動では同梱ランタイムを起動しない [否定]", () => {
  it("S0034_10 the cheer path does not import the bundled runtime module", () => {
    const root = join(import.meta.dirname, "..", "..");
    for (const file of [
      "src/main/keyHook.ts",
      "src/main/cheerRuntime.ts",
      "src/core/runtime.ts",
      "src/core/index.ts",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/bundledRuntime/);
    }
  });
});

describe("bundledRuntime / 引数配列で起動し、シェルを経由しない [否定]", () => {
  it("S0034_11 spawns with the executable path and an argument array, without a shell", () => {
    spawnMock.mockReturnValue({ on: () => {}, kill: () => {} });
    const [ollama] = resolveBundledRuntimes({
      resourcesDir: RESOURCES,
      userDataDir: USER_DATA,
      platform: "win32",
    });
    createNodeRuntimeSpawn()(ollama!.binPath, ollama!.args, ollama!.env);
    const [command, args, options] = spawnMock.mock.calls[0]!;
    expect(command).toBe(OLLAMA_BIN);
    expect(Array.isArray(args)).toBe(true);
    expect(options.shell).toBe(false);
  });
});

describe("bundledRuntime / 同梱ランタイムは 127.0.0.1 だけで待ち受け、モデルの置き場を userData 配下に向ける", () => {
  it("S0034_12 binds both runtimes to 127.0.0.1 and points the Ollama models under userData", () => {
    const [ollama, voicevox] = resolveBundledRuntimes({
      resourcesDir: RESOURCES,
      userDataDir: USER_DATA,
      platform: "win32",
    });
    expect(ollama!.env.OLLAMA_HOST).toBe("127.0.0.1:11434");
    expect(ollama!.env.OLLAMA_MODELS!.startsWith(`${USER_DATA}/`)).toBe(true);
    expect(voicevox!.args).toEqual(["--host", "127.0.0.1", "--port", "50021"]);
  });
});

describe("bundledRuntime / 同梱ランタイムが無ければ起動を試みない [境界]", () => {
  it("S0034_13 starts nothing and raises no error without the bundled runtimes", async () => {
    const { controller, children } = setup({ hasFiles: false });
    await expect(controller.onMainWindowShown()).resolves.toBeUndefined();
    await expect(controller.beforeGeneration()).resolves.toBeUndefined();
    expect(children).toEqual([]);
  });
});
