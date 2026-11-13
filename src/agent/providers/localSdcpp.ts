// local-sdcpp: ImageGenerator のローカル実装(sd.cpp 子プロセス)。生成の画像の工程でのみ起動、常駐しない。
// 要件: docs/integrations.md「画像 (sd.cpp / 外部)」
//   同一シード / タイムアウト・失敗時はプロセス終了(ゾンビ防止) /
//   画像タグは呼び出し側がプロンプトに入れる(論点 0036。旧 通常/喜び/激励の固定タグは持たない) /
//   子プロセスはタイムアウト・キャンセル・重複起動排他を持つ [不変条件]。
// spawn / readOutput は注入(main プロセスが child_process.spawn と fs 読み出しを渡す)。
// 同梱するのは CPU 版だけで、GPU への切り替えは持たない(論点 0040)。

import type { ImageGenerator, ImageGenerationRequest } from "../../core/providers/types.js";

export interface ChildHandleLike {
  on(event: "close" | "error", listener: (arg: unknown) => void): void;
  kill(signal?: string): void;
}

export type SpawnLike = (command: string, args: string[]) => ChildHandleLike;

const DEFAULT_STEPS = 4;
// S0046_05 どの画像もサンプラー lcm・CFG 1 で作る。LCM LoRA の前提(論点 0041)で、既定のサンプラーと CFG では
// 少ないステップ数でまともな絵にならない。CFG 1 では避ける語(ネガティブプロンプト)が効かないので渡さない(S0046_04)。
const SAMPLING_METHOD = "lcm";
const CFG_SCALE = 1;

export interface SdcppConfig {
  binPath: string;
  modelPath: string;
  loraPath?: string;
  steps?: number;
  spawn: SpawnLike;
  readOutput: (path: string) => Uint8Array;
  makeOutputPath?: (index: number) => string;
  // 下絵(S0046_06 / S0046_07)を sd.cpp に渡すための書き出し。sd.cpp はファイルのパスでしか下絵を受け取らない
  writeInput?: (path: string, bytes: Uint8Array) => void;
  makeInputPath?: (index: number) => string;
}

export function createSdcppImageGenerator(config: SdcppConfig): ImageGenerator {
  const {
    binPath,
    modelPath,
    loraPath,
    steps = DEFAULT_STEPS,
    spawn,
    readOutput,
    makeOutputPath = (i) => `sd-out-${i}.png`,
    writeInput,
    makeInputPath = (i) => `sd-in-${i}.png`,
  } = config;

  // 重複起動排他(不変条件): 常駐しない・同時に 1 生成のみ。
  let running = false;

  function buildArgs(
    request: ImageGenerationRequest,
    outPath: string,
    initPath: string | null,
  ): string[] {
    const args = [
      "-m",
      modelPath,
      "-p",
      request.prompt,
      "-s",
      String(request.seed),
      "--sampling-method",
      SAMPLING_METHOD,
      "--cfg-scale",
      String(CFG_SCALE),
      "--steps",
      String(request.steps ?? steps),
      "-W",
      String(request.width),
      "-H",
      String(request.height),
      "-o",
      outPath,
    ];
    if (loraPath) args.push("--lora-model-dir", loraPath);
    if (initPath !== null) {
      args.push("--init-img", initPath);
      if (request.strength !== undefined) args.push("--strength", String(request.strength));
    }
    return args;
  }

  function runOne(args: string[], outPath: string, timeoutMs: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const child = spawn(binPath, args);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL"); // タイムアウト時はプロセスを殺す(ゾンビ防止)
        reject(new Error(`sd.cpp timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      child.on("close", (arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const code = arg === null || typeof arg === "number" ? arg : Number(arg);
        if (code === 0) {
          try {
            resolve(readOutput(outPath));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        } else {
          reject(new Error(`sd.cpp exited with code ${code}`));
        }
      });
    });
  }

  return {
    id: "local-sdcpp",
    async generateImages(request: ImageGenerationRequest): Promise<Uint8Array[]> {
      if (running) {
        throw new Error("sd.cpp is already running(重複起動排他)");
      }
      running = true;
      try {
        const images: Uint8Array[] = [];
        for (let i = 0; i < request.count; i++) {
          const outPath = makeOutputPath(i);
          let initPath: string | null = null;
          if (request.initImage !== undefined) {
            if (writeInput === undefined) throw new Error("sd.cpp cannot take an init image");
            initPath = makeInputPath(i);
            writeInput(initPath, request.initImage);
          }
          images.push(
            await runOne(buildArgs(request, outPath, initPath), outPath, request.timeoutMs),
          );
        }
        return images;
      } finally {
        running = false; // 成否によらずロックを解放
      }
    },
  };
}
