// local-sdcpp: ImageGenerator のローカル実装(sd.cpp 子プロセス)。キャラ設定の「AIで生成」でのみ起動、常駐しない。
// spec: specs/integrations.md「画像 (sd.cpp / 外部)」
//   3 枚生成して終了 / 同一シード + 表情タグ差し替え / タイムアウト・失敗時はプロセス終了(ゾンビ防止) /
//   子プロセスはタイムアウト・キャンセル・重複起動排他を持つ [不変条件]。
// spawn / readOutput は注入(main プロセスが child_process.spawn と fs 読み出しを渡す)。
// [要確認] Vulkan iGPU→失敗時 CPU の自動切替は実バイナリ挙動に合わせて別途(specs/integrations.md)。

import type { ImageGenerator, ImageGenerationRequest } from "../../engine/providers/types.js";
import { EXPRESSION_TAGS, expressionTagAt } from "./expressions.js";

export { EXPRESSION_TAGS };

export interface ChildHandleLike {
  on(event: "close" | "error", listener: (arg: unknown) => void): void;
  kill(signal?: string): void;
}

export type SpawnLike = (command: string, args: string[]) => ChildHandleLike;

// 通常 / 喜び / 激励(specs/integrations.md)。同一シードでこのタグだけ差し替える。
// タグの正本は ./expressions.ts(外部プロバイダーと共有)。
const DEFAULT_STEPS = 4;

export interface SdcppConfig {
  binPath: string;
  modelPath: string;
  loraPath?: string;
  steps?: number;
  spawn: SpawnLike;
  readOutput: (path: string) => Uint8Array;
  makeOutputPath?: (index: number) => string;
  expressionTags?: string[];
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
    expressionTags = [...EXPRESSION_TAGS],
  } = config;

  // 重複起動排他(不変条件): 常駐しない・同時に 1 生成のみ。
  let running = false;

  function buildArgs(request: ImageGenerationRequest, tag: string, outPath: string): string[] {
    const args = [
      "-m",
      modelPath,
      "-p",
      `${request.prompt}, ${tag}`,
      "-s",
      String(request.seed),
      "--steps",
      String(steps),
      "-W",
      String(request.width),
      "-H",
      String(request.height),
      "-o",
      outPath,
    ];
    if (loraPath) args.push("--lora-model-dir", loraPath);
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
          const tag = expressionTagAt(i, expressionTags);
          const outPath = makeOutputPath(i);
          images.push(await runOne(buildArgs(request, tag, outPath), outPath, request.timeoutMs));
        }
        return images;
      } finally {
        running = false; // 成否によらずロックを解放
      }
    },
  };
}
