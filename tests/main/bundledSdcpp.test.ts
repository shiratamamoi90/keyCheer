// main/bundledSdcpp: 同梱した sd.cpp のパスの解決と、実行中の子プロセスの追跡。
// 要件: docs/integrations.md「画像 (sd.cpp / 外部)」(論点 0040)
// 子プロセスは偽物。実バイナリには触れない。

import { describe, it, expect, vi } from "vitest";
import {
  createChildTracker,
  hasSdcppFiles,
  resolveSdcppPaths,
} from "../../src/main/bundledSdcpp.js";
import type { ChildHandleLike } from "../../src/agent/providers/localSdcpp.js";

function makeChild() {
  const handlers: Record<string, ((arg: unknown) => void)[]> = {};
  const child: ChildHandleLike & {
    kill: ReturnType<typeof vi.fn<(signal?: string) => void>>;
    fireClose: (code: number | null) => void;
  } = {
    on: (event, listener) => {
      (handlers[event] ??= []).push(listener);
    },
    kill: vi.fn(),
    fireClose: (code) => handlers["close"]?.forEach((h) => h(code)),
  };
  return child;
}

describe("bundledSdcpp / アプリ終了時に、実行中の sd.cpp を止める", () => {
  it("S0040_05 kills the running child process and leaves finished ones alone", () => {
    // GIVEN 画像の工程で sd.cpp の子プロセスが実行中(もう 1 つは既に終わっている)
    const children = [makeChild(), makeChild()];
    let next = 0;
    const tracker = createChildTracker(() => children[next++]!);
    tracker.spawn("sd-cli", ["-p", "a"]);
    tracker.spawn("sd-cli", ["-p", "b"]);
    children[0]!.fireClose(0);

    // WHEN アプリを終了する
    tracker.stopAll();

    // THEN 実行中の子プロセスを止める。終わったものには触れない
    expect(children[1]!.kill).toHaveBeenCalledTimes(1);
    expect(children[0]!.kill).not.toHaveBeenCalled();
  });
});

describe("bundledSdcpp / パスの解決", () => {
  it("resolves the executable under the bundled resources and the weights under userData", () => {
    const paths = resolveSdcppPaths({
      resourcesDir: "/res",
      userDataDir: "/data",
      platform: "win32",
    });

    expect(paths).toEqual({
      binPath: "/res/sdcpp/sd-cli.exe",
      modelPath: "/data/weights/image/Counterfeit-V3.0_fix_fp16.safetensors",
      loraDir: "/data/weights/image/lora",
      loraPath: "/data/weights/image/lora/lcm-lora-sdv1-5.safetensors",
    });
  });

  it("reports the files as present only when all three exist", () => {
    const paths = resolveSdcppPaths({
      resourcesDir: "/res",
      userDataDir: "/data",
      platform: "linux",
    });
    const all = [paths.binPath, paths.modelPath, paths.loraPath];

    expect(hasSdcppFiles(paths, (p) => all.includes(p))).toBe(true);
    expect(hasSdcppFiles(paths, (p) => p !== paths.loraPath && all.includes(p))).toBe(false);
  });
});
