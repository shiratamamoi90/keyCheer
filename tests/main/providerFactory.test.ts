// main/providerFactory: ローカルの生成器を組み立てる(論点 0054)。
// 実際には通信しない — 組み立てだけを縛る(生成の中身は各 provider のテストが持つ)。

import { describe, it, expect } from "vitest";
import {
  createImageGenerator,
  createTextGenerator,
  createVoiceSynthesizer,
  type SdcppRuntimeDeps,
} from "../../src/main/providerFactory.js";
import { resolveSdcppPaths } from "../../src/main/bundledSdcpp.js";
import type { ChildHandleLike } from "../../src/agent/providers/localSdcpp.js";
import { DEFAULT_SYSTEM_CONFIG } from "../../src/core/shared/types.js";

const deps = { system: DEFAULT_SYSTEM_CONFIG };

describe("providerFactory / ローカルの生成器", () => {
  it("builds the Ollama text generator and the VOICEVOX synthesizer without any key", () => {
    // 生成はローカルだけ(論点 0054)。組み立てに秘密は要らない
    const text = createTextGenerator(deps);
    expect(text.id).toBe("local-ollama");
    expect(typeof text.generateMessages).toBe("function");
    expect(typeof text.generateImageTags).toBe("function");
    const voice = createVoiceSynthesizer(deps);
    expect(voice.id).toBe("local-voicevox");
    expect(typeof voice.synthesize).toBe("function");
  });
});

// --- 同梱した sd.cpp(論点 0040。docs/integrations.md「画像 (sd.cpp / 外部)」)---

const RESOURCES = "C:/Program Files/KeyCheer/resources";
const USER_DATA = "C:/Users/u/AppData/Roaming/KeyCheer";
const SD_BIN = `${RESOURCES}/sdcpp/sd-cli.exe`;
const SD_MODEL = `${USER_DATA}/weights/image/Counterfeit-V3.0_fix_fp16.safetensors`;
const SD_LORA_DIR = `${USER_DATA}/weights/image/lora`;
const SD_LORA = `${SD_LORA_DIR}/lcm-lora-sdv1-5.safetensors`;

function sdcppRuntime(existing: readonly string[]) {
  const spawned: { command: string; args: string[] }[] = [];
  const runtime: SdcppRuntimeDeps = {
    paths: resolveSdcppPaths({
      resourcesDir: RESOURCES,
      userDataDir: USER_DATA,
      platform: "win32",
    }),
    exists: (path) => existing.includes(path),
    spawn: (command, args) => {
      spawned.push({ command, args });
      const handlers: Record<string, ((arg: unknown) => void)[]> = {};
      const child: ChildHandleLike = {
        on: (event, listener) => {
          (handlers[event] ??= []).push(listener);
        },
        kill: () => {},
      };
      queueMicrotask(() => handlers["close"]?.forEach((h) => h(0)));
      return child;
    },
    readOutput: () => new Uint8Array([7]),
    writeInput: () => {},
    removeFile: () => {},
    tempDir: "C:/Temp/keycheer",
  };
  return { runtime, spawned };
}

const imageRequest = {
  prompt: "1girl",
  seed: 42,
  count: 1,
  width: 512,
  height: 768,
  timeoutMs: 60_000,
};

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

describe("providerFactory / 同梱した sd.cpp と重みが揃っていれば local-sdcpp で画像の工程を実行する", () => {
  it("S0040_01 builds local-sdcpp and spawns the bundled sd.cpp with the weights", async () => {
    // GIVEN providers.image = local-sdcpp、同梱した sd.cpp の実行ファイルとモデル重みがどちらも置き場にある
    const { runtime, spawned } = sdcppRuntime([SD_BIN, SD_MODEL, SD_LORA]);

    // WHEN 画像プロバイダーを組み立てて 1 枚作る
    const result = createImageGenerator({ ...deps, sdcpp: runtime });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const images = await result.generator.generateImages(imageRequest);

    // THEN 同梱した sd.cpp を子プロセスで起動して画像を作る
    expect(result.generator.id).toBe("local-sdcpp");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.command).toBe(SD_BIN);
    expect(valueAfter(spawned[0]!.args, "-m")).toBe(SD_MODEL);
    expect(valueAfter(spawned[0]!.args, "--lora-model-dir")).toBe(SD_LORA_DIR);
    expect(valueAfter(spawned[0]!.args, "-o")).toMatch(/^C:\/Temp\/keycheer\//);
    expect(images.map((bytes) => Array.from(bytes))).toEqual([[7]]);
  });
});

describe("providerFactory / 実行ファイルか重みが無ければ子プロセスを起動しない [異常系]", () => {
  it("S0040_02 does not build local-sdcpp when the executable or a weight file is missing", () => {
    // GIVEN 実行ファイル・ベースモデル・LoRA のどれかが置き場に無い(または同梱物の情報そのものが無い)
    const missingOne = [
      [SD_MODEL, SD_LORA],
      [SD_BIN, SD_LORA],
      [SD_BIN, SD_MODEL],
    ];

    for (const existing of missingOne) {
      // WHEN 画像プロバイダーを組み立てる
      const { runtime, spawned } = sdcppRuntime(existing);
      const result = createImageGenerator({ ...deps, sdcpp: runtime });

      // THEN 組み立てず(= 画像なしで生成を完了する)、子プロセスを起動しない
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("runtime-not-installed");
      expect(spawned).toEqual([]);
    }
    const withoutRuntime = createImageGenerator(deps);
    expect(withoutRuntime.ok).toBe(false);
  });
});

describe("providerFactory / 起動するのは同梱した CPU 版だけ [否定]", () => {
  it("S0040_03 resolves exactly one executable per platform and passes no GPU option", async () => {
    // GIVEN GPU や Vulkan が使える機械かどうかにかかわらず
    const { runtime, spawned } = sdcppRuntime([SD_BIN, SD_MODEL, SD_LORA]);

    // WHEN local-sdcpp で画像を作る
    const result = createImageGenerator({ ...deps, sdcpp: runtime });
    if (result.ok) await result.generator.generateImages(imageRequest);

    // THEN 起動するのは同梱した実行ファイル 1 つだけで、GPU に関する引数は無い
    expect(spawned.map((s) => s.command)).toEqual([SD_BIN]);
    const gpuOptions = spawned[0]!.args.filter((arg) =>
      /vulkan|cuda|gpu|rocm|--backend/i.test(arg),
    );
    expect(gpuOptions).toEqual([]);
    const linux = resolveSdcppPaths({
      resourcesDir: "/opt/kc",
      userDataDir: "/home/u/kc",
      platform: "linux",
    });
    expect(linux.binPath).toBe("/opt/kc/sdcpp/sd-cli");
  });
});

describe("providerFactory / 実行ファイルと重みのパスを設定や入力から受け取らない [否定]", () => {
  it("S0040_04 ignores path-like values written in the settings", async () => {
    // GIVEN 設定 JSON に、実行ファイル・モデル重みのパスにあたる値が書かれている
    const system = {
      ...DEFAULT_SYSTEM_CONFIG,
      sdcppPath: "C:/evil/sd.exe",
      imageGen: { binPath: "C:/evil/sd.exe", modelPath: "C:/evil/model.safetensors" },
    };
    const { runtime, spawned } = sdcppRuntime([SD_BIN, SD_MODEL, SD_LORA]);

    // WHEN local-sdcpp を組み立てて 1 枚作る
    const result = createImageGenerator({ ...deps, system, sdcpp: runtime });
    if (result.ok) await result.generator.generateImages(imageRequest);

    // THEN その値を使わない。パスは同梱物の配置と重みの置き場だけから決まる
    expect(spawned[0]!.command).toBe(SD_BIN);
    expect(spawned[0]!.args.some((arg) => arg.includes("evil"))).toBe(false);
    expect(valueAfter(spawned[0]!.args, "-m")).toBe(SD_MODEL);
  });
});
