// imageModelComparison: ローカル画像生成のベースモデルを baseline と比べる計測(論点 0041)。
//
// アプリと同じ経路で呼ぶ:画像タグは createOllamaTextGenerator + core/characterImage、
// 画像は createSdcppImageGenerator。経路を eval 側で組み直すと、測った値がアプリの挙動と食い違う。
// 振るのはベースモデルだけ(1 論点 = 1 変数)。画像タグは先に全部作って保存し、全候補で同じものを使う
// (タグの揺れをモデルの差に混ぜない)。
//
// アプリの実装にまだ無く、計測でだけ足しているものが 2 つある(決まった値は実装に入れる):
//   - サンプラーと CFG(buildSdcppExtraArgs)。LCM LoRA は専用のサンプラーと低い CFG が前提
//   - プロンプト末尾の `<lora:名前:1>`。sd.cpp は置き場を渡すだけでは LoRA を適用しない
//
// 作り方の計測(論点 0045。imageProcessComparison)も、ここの sd.cpp の起動(createContainerSdRunner)を使う。
//
// 絵の良し悪しは指標にしない。並べて見る頁(buildComparisonPage)を作り、人間が判断する。

import { spawn as spawnProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generatePool } from "../agent/poolGenerator.js";
import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import { createSdcppImageGenerator, type SpawnLike } from "../agent/providers/localSdcpp.js";
import {
  buildImageTagPrompt,
  buildImageTagText,
  CHARACTER_IMAGE_KINDS,
  validateImageTagResponse,
  type CharacterImageKind,
} from "../core/characterImage.js";
import { EVAL_CHARACTERS } from "./textModelComparison.js";

// コンテナの中のパス。sd.cpp は開発機の GLIBC では動かないのでコンテナで動かす
// (理由は scripts/image-eval.Dockerfile)。
const CONTAINER_SDCPP_BIN = "/sd/sd-cli";
const CONTAINER_MODEL_DIR = "/models";
const CONTAINER_LORA_DIR = "/models/lora";
const CONTAINER_OUT_DIR = "/out";
const KB_PER_MB = 1024;

export interface ImageCase {
  character: string;
  kind: CharacterImageKind;
  trial: number;
  seed: number;
  // 画像タグを連結したもの(アプリが画像プロバイダーへ渡すプロンプトと同じ)
  prompt: string;
}

export interface ImageRecord extends ImageCase {
  variant: string;
  latencyMs: number;
  // 測れなかったとき(失敗・time の出力が読めない)は null
  peakMemoryMb: number | null;
  failed: boolean;
  error?: string;
  // 計測の出力フォルダからの相対パス。失敗なら null
  file: string | null;
}

export interface ImageSummary {
  variant: string;
  images: number;
  failedRatePct: number;
  meanLatencyMs: number;
  maxLatencyMs: number;
  maxPeakMemoryMb: number | null;
}

export interface SamplerSettings {
  samplingMethod: string;
  cfgScale: number;
}

export interface ImageTagSettings {
  endpoint: string;
  tagModel: string;
  baseSeed: number;
  generationsPerCase: number;
  characterCount: number;
  timeoutMsPerBucket: number;
}

export interface ImageTrialSettings extends SamplerSettings {
  variant: string;
  // 計測の出力フォルダ。画像は <outDir>/<variant>/ に置く
  outDir: string;
  // scripts/fetch-image-eval.sh の置き場
  sdcppDir: string;
  modelDir: string;
  containerImage: string;
  loraName: string;
  steps: number;
  width: number;
  height: number;
  timeoutMsPerImage: number;
}

// --- 指標(論点 0041「測り方」の自動指標)。どれも記録から決定的に計算する ---

export function computeImageSummary(
  variant: string,
  records: readonly ImageRecord[],
): ImageSummary {
  const succeeded = records.filter((r) => !r.failed);
  // 失敗した 1 枚の時間は上限値や即時終了の値で、生成にかかる時間ではないので混ぜない
  const latencies = succeeded.map((r) => r.latencyMs);
  const memories = records.flatMap((r) => (r.peakMemoryMb === null ? [] : [r.peakMemoryMb]));
  return {
    variant,
    images: records.length,
    failedRatePct:
      records.length === 0
        ? 0
        : Math.round(((records.length - succeeded.length) / records.length) * 1000) / 10,
    meanLatencyMs:
      latencies.length === 0
        ? 0
        : Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length),
    maxLatencyMs: latencies.length === 0 ? 0 : Math.max(...latencies),
    maxPeakMemoryMb: memories.length === 0 ? null : Math.max(...memories),
  };
}

// 計測でだけ sd.cpp に足す引数(アプリの実装はまだ渡していない)
export function buildSdcppExtraArgs(settings: SamplerSettings): string[] {
  return ["--sampling-method", settings.samplingMethod, "--cfg-scale", String(settings.cfgScale)];
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function caseKey(record: ImageCase): string {
  return `${record.character}/${record.kind}/${record.trial}`;
}

// 同じケース(キャラ・画像の種類・試行)を候補ごとに横に並べる。主指標は人間の目なので、見比べやすさだけを考える。
// プロンプトはモデルが出した画像タグなので、頁に埋める前に必ずエスケープする。
export function buildComparisonPage(
  variants: readonly string[],
  records: readonly ImageRecord[],
): string {
  const byCase = new Map<string, ImageRecord[]>();
  for (const record of records) {
    const group = byCase.get(caseKey(record)) ?? [];
    group.push(record);
    byCase.set(caseKey(record), group);
  }

  const rows = [...byCase.values()].map((group) => {
    const first = group[0]!;
    const cells = variants.map((variant) => {
      const record = group.find((r) => r.variant === variant);
      if (record === undefined) return "<td>未計測</td>";
      if (record.failed || record.file === null) {
        return `<td>失敗<br><small>${escapeHtml(record.error ?? "")}</small></td>`;
      }
      const src = record.file.split("/").map(encodeURIComponent).join("/");
      const seconds = (record.latencyMs / 1000).toFixed(1);
      const memory = record.peakMemoryMb === null ? "—" : `${record.peakMemoryMb} MB`;
      return `<td><img src="${src}" width="256" alt=""><br><small>${seconds} 秒 / ${memory}</small></td>`;
    });
    const label = `${escapeHtml(first.character)} / ${escapeHtml(first.kind)} / 試行 ${first.trial}(seed ${first.seed})`;
    return `<tr class="case"><th>${label}<br><small>${escapeHtml(first.prompt)}</small></th>${cells.join("")}</tr>`;
  });

  const head = variants.map((v) => `<th>${escapeHtml(v)}</th>`).join("");
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8"><title>画像のベースモデルの比較</title>',
    "<style>body{font-family:sans-serif}table{border-collapse:collapse}th,td{border:1px solid #999;padding:8px;vertical-align:top}th{max-width:320px;text-align:left;font-weight:normal}</style>",
    "</head><body><table>",
    `<tr><th>ケース</th>${head}</tr>`,
    ...rows,
    "</table></body></html>",
  ].join("\n");
}

// --- 計測の実行(ここから下は I/O) ---

// 画像タグを全ケース分作る。プールはキャラごとに 1 回だけ作り、試行ごとにシードを変えてタグを出す。
// タグの形式違反はそのケースを外す(アプリでは「その画像だけ失敗」。モデルの比較には使えない)。
export async function buildImageCases(
  settings: ImageTagSettings,
  onProgress: (message: string) => void,
): Promise<{ cases: ImageCase[]; tagFailureCount: number }> {
  const generator = createOllamaTextGenerator({
    endpoint: settings.endpoint,
    model: settings.tagModel,
  });
  const cases: ImageCase[] = [];
  let tagFailureCount = 0;

  for (const character of EVAL_CHARACTERS.slice(0, settings.characterCount)) {
    onProgress(`${character.name}: セリフを作る`);
    const state = await generatePool({
      characterId: character.name,
      character,
      generator,
      seed: settings.baseSeed,
      timeoutMsPerBucket: settings.timeoutMsPerBucket,
    });
    for (let trial = 0; trial < settings.generationsPerCase; trial++) {
      const seed = settings.baseSeed + trial;
      for (const kind of CHARACTER_IMAGE_KINDS) {
        try {
          const raw = await generator.generateImageTags({
            prompt: buildImageTagPrompt(character, kind, state.pool),
            seed,
            timeoutMs: settings.timeoutMsPerBucket,
          });
          if (validateImageTagResponse(raw).length > 0) {
            tagFailureCount += 1;
            continue;
          }
          cases.push({
            character: character.name,
            kind,
            trial,
            seed,
            prompt: buildImageTagText(raw),
          });
        } catch {
          tagFailureCount += 1;
        }
      }
    }
  }
  return { cases, tagFailureCount };
}

function readPeakMemoryMb(path: string): number | null {
  try {
    // time は失敗時に説明の行を先に書くので、最後の行(最大 RSS、KB)だけを読む
    const lastLine = readFileSync(path, "utf8").trim().split("\n").at(-1) ?? "";
    const kb = Number(lastLine);
    return Number.isFinite(kb) && kb > 0 ? Math.round(kb / KB_PER_MB) : null;
  } catch {
    return null;
  } finally {
    rmSync(path, { force: true });
  }
}

export interface SdRunRequest {
  // 出力のファイル名(拡張子なし)。<outDir>/<variant>/<name>.png に置く
  name: string;
  // sd.cpp にそのまま渡すプロンプト(LoRA の指定も含める)
  prompt: string;
  seed: number;
  // この 1 枚にだけ足す引数(下絵と強さなど。論点 0045)
  extraArgs?: readonly string[];
}

export interface SdRunOutcome {
  latencyMs: number;
  // 測れなかったとき(失敗・time の出力が読めない)は null
  peakMemoryMb: number | null;
  failed: boolean;
  error?: string;
}

export type SdRunner = (request: SdRunRequest) => Promise<SdRunOutcome>;

// コンテナの中の sd.cpp で 1 枚ずつ作る。アプリと同じ createSdcppImageGenerator を通す
// (経路を組み直すと、測った値がアプリの挙動と食い違う)。
export function createContainerSdRunner(settings: ImageTrialSettings): SdRunner {
  const variantOutDir = join(settings.outDir, settings.variant);
  mkdirSync(variantOutDir, { recursive: true });
  const samplerArgs = buildSdcppExtraArgs(settings);
  // 1 枚ごとに変わる出力名と引数。createSdcppImageGenerator は出力先を番号からしか受け取らないため外に持つ
  let currentName = "";
  let currentExtraArgs: readonly string[] = [];
  let runCount = 0;

  // シェルを経由せず引数配列で起動する(不変条件)。ネットワークは切る(生成に通信は要らない)
  const spawnInContainer: SpawnLike = (command, args) => {
    runCount += 1;
    const containerName = `keycheer-image-eval-${process.pid}-${runCount}`;
    const child = spawnProcess(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--name",
        containerName,
        "--user",
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        "-v",
        `${settings.sdcppDir}:/sd:ro`,
        "-v",
        `${settings.modelDir}:${CONTAINER_MODEL_DIR}:ro`,
        "-v",
        `${variantOutDir}:${CONTAINER_OUT_DIR}`,
        settings.containerImage,
        "/usr/bin/time",
        "-f",
        "%M",
        "-o",
        `${CONTAINER_OUT_DIR}/${currentName}.mem`,
        command,
        ...args,
        ...samplerArgs,
        ...currentExtraArgs,
      ],
      { stdio: "ignore" },
    );
    return {
      on: (event, listener) => {
        child.on(event, listener);
      },
      kill: (signal) => {
        // docker のクライアントを殺してもコンテナは残るので、コンテナも止める
        spawnProcess("docker", ["kill", containerName], { stdio: "ignore" });
        child.kill(signal as NodeJS.Signals | undefined);
      },
    };
  };

  const generator = createSdcppImageGenerator({
    binPath: CONTAINER_SDCPP_BIN,
    modelPath: `${CONTAINER_MODEL_DIR}/${settings.variant}.safetensors`,
    loraPath: CONTAINER_LORA_DIR,
    steps: settings.steps,
    spawn: spawnInContainer,
    readOutput: () => readFileSync(join(variantOutDir, `${currentName}.png`)),
    makeOutputPath: () => `${CONTAINER_OUT_DIR}/${currentName}.png`,
  });

  return async (request) => {
    currentName = request.name;
    currentExtraArgs = request.extraArgs ?? [];
    const started = performance.now();
    let failed = false;
    let error: string | undefined;
    try {
      await generator.generateImages({
        prompt: request.prompt,
        seed: request.seed,
        count: 1,
        width: settings.width,
        height: settings.height,
        timeoutMs: settings.timeoutMsPerImage,
      });
    } catch (e) {
      failed = true;
      error = String(e);
    }
    return {
      latencyMs: Math.round(performance.now() - started),
      peakMemoryMb: readPeakMemoryMb(join(variantOutDir, `${request.name}.mem`)),
      failed,
      ...(error !== undefined ? { error } : {}),
    };
  };
}

// コンテナの中から見た、同じ候補の出力ファイルのパス(下絵として渡すときに使う)
export function buildContainerOutputPath(name: string): string {
  return `${CONTAINER_OUT_DIR}/${name}.png`;
}

export async function runImageTrials(
  settings: ImageTrialSettings,
  cases: readonly ImageCase[],
  onRecord: (record: ImageRecord) => void,
): Promise<ImageRecord[]> {
  const runSd = createContainerSdRunner(settings);
  const records: ImageRecord[] = [];
  for (const imageCase of cases) {
    const name = `${imageCase.character}-${imageCase.kind}-t${imageCase.trial}`;
    const outcome = await runSd({
      name,
      prompt: `${imageCase.prompt}, <lora:${settings.loraName}:1>`,
      seed: imageCase.seed,
    });
    const record: ImageRecord = {
      ...imageCase,
      variant: settings.variant,
      ...outcome,
      file: outcome.failed ? null : `${settings.variant}/${name}.png`,
    };
    records.push(record);
    onRecord(record);
  }
  return records;
}
