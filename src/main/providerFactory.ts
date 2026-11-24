// providerFactory: ローカルの生成器を組み立てる(論点 0054。生成はローカルだけで、種別ごとに 1 つ)。
// 要件: docs/integrations.md「プロバイダー識別子」・S0040_01〜04
//
// **このモジュールと characterCreationIpc だけがプロバイダー実装を import する。**
// index.ts(発動経路の配線)には混ぜない — 発動経路は外部依存ゼロという不変条件を
// コードの構造としても保つため(eslint.config.js の mainCheerPathRestrictedPatterns)。

import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import { createVoicevoxSynthesizer } from "../agent/providers/localVoicevox.js";
import { createSdcppImageGenerator, type SpawnLike } from "../agent/providers/localSdcpp.js";
import { hasSdcppFiles, type SdcppPaths } from "./bundledSdcpp.js";
import type {
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../core/providers/types.js";
import type { SystemConfig } from "../core/shared/types.js";

// 同梱した sd.cpp を動かすのに要るもの(論点 0040)。パスは同梱物の配置と重みの置き場から決めたものを受け取り、
// 設定(system)からは読まない(S0040_04)。子プロセスとファイルの I/O は main が渡す
export interface SdcppRuntimeDeps {
  paths: SdcppPaths;
  exists: (path: string) => boolean;
  spawn: SpawnLike;
  readOutput: (path: string) => Uint8Array;
  writeInput: (path: string, bytes: Uint8Array) => void;
  removeFile: (path: string) => void;
  tempDir: string; // sd.cpp の出力と下絵を置く一時の置き場
}

export interface ProviderFactoryDeps {
  system: SystemConfig;
  /** 同梱した sd.cpp。渡さなければ local-sdcpp は組み立てない。 */
  sdcpp?: SdcppRuntimeDeps;
}

// runtime-not-installed: sd.cpp の実行ファイルかモデル重みが置き場に無い(S0040_02)。
// 画像の失敗は生成を止めない(S0036_10)
export type ImageBuildFailure = "runtime-not-installed";

export type ImageGeneratorResult =
  | { ok: true; generator: ImageGenerator }
  | { ok: false; reason: ImageBuildFailure };

// テキストプロバイダーは画像タグの要求も受け持つ(論点 0036)。ローカルなので組み立ては失敗しない
// (Ollama が起動していなければ、生成の呼び出しで失敗する。S0016_18)
export function createTextGenerator(deps: ProviderFactoryDeps): TextGenerator & ImageTagGenerator {
  return createOllamaTextGenerator({
    endpoint: deps.system.ollamaEndpoint,
    model: deps.system.ollamaModel,
  });
}

export function createVoiceSynthesizer(deps: ProviderFactoryDeps): VoiceSynthesizer {
  return createVoicevoxSynthesizer({ endpoint: deps.system.voicevoxEndpoint });
}

export function createImageGenerator(deps: ProviderFactoryDeps): ImageGeneratorResult {
  // S0040_02 実行ファイルか重みが無ければ子プロセスを起動しない — 組み立てないので画像の工程に進まず、
  // 生成は画像なしで完了する(S0036_10 / S0055_09)
  const sdcpp = deps.sdcpp;
  if (sdcpp === undefined || !hasSdcppFiles(sdcpp.paths, sdcpp.exists)) {
    return { ok: false, reason: "runtime-not-installed" };
  }
  // S0040_01 同梱した sd.cpp と重みが揃っていれば local-sdcpp で画像の工程を実行する
  return {
    ok: true,
    generator: createSdcppImageGenerator({
      binPath: sdcpp.paths.binPath,
      modelPath: sdcpp.paths.modelPath,
      loraPath: sdcpp.paths.loraDir,
      spawn: sdcpp.spawn,
      readOutput: sdcpp.readOutput,
      writeInput: sdcpp.writeInput,
      removeFile: sdcpp.removeFile,
      makeOutputPath: (index) => `${sdcpp.tempDir}/sd-out-${index}.png`,
      makeInputPath: (index) => `${sdcpp.tempDir}/sd-in-${index}.png`,
    }),
  };
}
