// bundledSdcpp: 同梱した sd.cpp のパスの解決と、実行中の子プロセスの追跡。
// 要件: docs/integrations.md「画像 (sd.cpp / 外部)」S0040_01〜05(論点 0040)
//
// 同梱するのは公式リリースの CPU 版 1 つだけ(Vulkan・GPU 向けは持たない)。
// Electron にも child_process にも触れない(起動の手段は注入)。発動経路からは import しない。

import type { ChildHandleLike, SpawnLike } from "../agent/providers/localSdcpp.js";

// 同梱物の中の置き場と、実行ファイルの名前(公式リリースの zip の中身。scripts/fetch-sdcpp.sh が同じ名前で置く)
const SDCPP_DIR_NAME = "sdcpp";
const SDCPP_BIN_NAME = "sd-cli";
// 画像の重みの置き場とファイル名(論点 0041 の決定。取得の実装 — 論点 0042 / 0048 — も同じ名前で置く)。
// LoRA のファイル名は、プロンプトの <lora:lcm-lora-sdv1-5:1> と揃える必要がある(sd.cpp は名前で探す)
const IMAGE_WEIGHTS_DIR = "weights/image";
const BASE_MODEL_FILE = "Counterfeit-V3.0_fix_fp16.safetensors";
const LORA_DIR_NAME = "lora";
const LORA_FILE = "lcm-lora-sdv1-5.safetensors";

export interface SdcppPaths {
  binPath: string;
  modelPath: string;
  loraDir: string;
  loraPath: string;
}

// S0040_03 起動するのは同梱した CPU 版だけ — 実行ファイルは 1 つで、GPU の有無では変わらない
// S0040_04 実行ファイルと重みのパスを設定や入力から受け取らない — 引数は同梱物の配置と重みの置き場だけ
export function resolveSdcppPaths(input: {
  resourcesDir: string;
  userDataDir: string;
  platform: string;
}): SdcppPaths {
  const extension = input.platform === "win32" ? ".exe" : "";
  const weightsDir = `${input.userDataDir}/${IMAGE_WEIGHTS_DIR}`;
  const loraDir = `${weightsDir}/${LORA_DIR_NAME}`;
  return {
    binPath: `${input.resourcesDir}/${SDCPP_DIR_NAME}/${SDCPP_BIN_NAME}${extension}`,
    modelPath: `${weightsDir}/${BASE_MODEL_FILE}`,
    loraDir,
    loraPath: `${loraDir}/${LORA_FILE}`,
  };
}

// S0040_02 実行ファイルか重みが無ければ子プロセスを起動しない — の判定
export function hasSdcppFiles(paths: SdcppPaths, exists: (path: string) => boolean): boolean {
  return exists(paths.binPath) && exists(paths.modelPath) && exists(paths.loraPath);
}

export interface ChildTracker {
  spawn: SpawnLike;
  stopAll(): void;
}

// S0040_05 アプリ終了時に、実行中の sd.cpp を止める
// 起動した子プロセスを覚えておき、終わったら忘れる。CPU での生成は 1 枚に 1 分以上かかるので、
// 追わずに終了すると子プロセスだけが残って CPU を使い続ける。
export function createChildTracker(spawn: SpawnLike): ChildTracker {
  const running = new Set<ChildHandleLike>();
  return {
    spawn(command, args) {
      const child = spawn(command, args);
      running.add(child);
      child.on("close", () => running.delete(child));
      child.on("error", () => running.delete(child));
      return child;
    },
    stopAll() {
      for (const child of running) child.kill("SIGKILL");
      running.clear();
    },
  };
}
