// eval: 探索ループの評価スクリプト。非決定的な論点(decisions/)の指標計測を駆動する。
//
// 使い方: npm run eval -- <論点フォルダ>
//   例: npm run eval -- decisions/undecided/0027-local-text-model-sarashina
// 論点フォルダの config.yaml を読み、baseline と variant を同じ条件で測る。
// 振る変数は `axis` で選ぶ:model(既定。論点 0027)はモデル名、prompt(論点 0026)はプロンプト案、
// image_model(論点 0041)は画像のベースモデル(runImageModelEval。画像を出力フォルダに置く)、
// cheer_image_tags(論点 0062)は応援種別の画像の画像タグの決め方(runCheerImageEval)、
// background_removal(論点 0063)・palette_size(論点 0064)は 0062 で描いた絵の後処理だけ(runPostProcessEval)、
// negative_prompt(論点 0065)は避ける語と CFG(runNegativePromptEval)、
// image_process(論点 0045)は画像の作り方(runImageProcessEval。末尾に probe を付けると、下絵から描き直す
// 強さを決めるための試し、background を付けると抜く背景の色を決めるための試しだけを回す:
// npm run eval -- <論点フォルダ> probe)。
// 既定を model にするのは、決定済みの 0027 の config.yaml を書き換えずに再実行できるようにするため。
// 生の記録(JSONL)は KEYCHEER_EVAL_OUT(既定 ~/.cache/keycheer-eval)に置き、リポジトリには
// 入れない。result.md に書くのは集計値だけ(@.claude/rules/experiment-rules.md「規律」)。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { buildSystemPrompt } from "../agent/poolGenerator.js";
import { DEFAULT_SYSTEM_CONFIG } from "../core/shared/types.js";
import { parseFlatConfig, requireNumber, requireString, type FlatConfig } from "./configFile.js";
import {
  buildImageCases,
  computeImageSummary,
  runImageTrials,
  type ImageRecord,
} from "./imageModelComparison.js";
import {
  BACKGROUND_PLACEHOLDER,
  buildProcessCases,
  computeProcessSummary,
  runProcessTrials,
  type PaletteColor,
  type ProcessRecord,
  type ProcessTrialSettings,
} from "./imageProcessComparison.js";
import {
  buildCheerTagCases,
  computeCheerDifferenceSummary,
  type CheerTagCase,
  isCheerImageVariant,
  runCheerDifferenceTrials,
} from "./cheerImageDifference.js";
import {
  applyTwoPassBackgroundRemoval,
  computeOpaqueBlobCount,
  isBackgroundVariant,
  runPostProcessComparison,
  type PostProcessRunInput,
} from "./postProcessComparison.js";
import { decodePng } from "./png.js";
import { applyProbabilityMask, createU2netSegmenter } from "./segmentationMask.js";
import {
  applyBackgroundRemoval,
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
} from "../core/characterImage.js";
import { resolvePromptBuilder } from "./promptVariant.js";
import { computeSummary, runTrials, type ComparisonSettings } from "./textModelComparison.js";

type VariantSettings = Pick<ComparisonSettings, "variant" | "model" | "buildPrompt">;

// 比べる 2 案を baseline → variant の順で作る
function buildVariants(config: FlatConfig): VariantSettings[] {
  const axis = config.axis ?? "model";
  if (axis === "model") {
    return [requireString(config, "baseline"), requireString(config, "ollama_model")].map(
      (model) => ({ variant: model, model, buildPrompt: buildSystemPrompt }),
    );
  }
  if (axis === "prompt") {
    const model = requireString(config, "model");
    return [requireString(config, "baseline"), requireString(config, "variant")].map((name) => ({
      variant: name,
      model,
      buildPrompt: resolvePromptBuilder(name),
    }));
  }
  throw new Error(`config.yaml: axis ${axis} は model / prompt のどちらか`);
}

// 画像のベースモデルの比較(論点 0041)。sd.cpp と重みは scripts/fetch-image-eval.sh が置いたものを使う
async function runImageModelEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
): Promise<void> {
  const cacheRoot =
    process.env.KEYCHEER_MODEL_CACHE ?? join(homedir(), ".cache", "keycheer-models");
  const imageEvalDir = join(cacheRoot, "image-eval");
  const sdcppTag = requireString(config, "sdcpp_tag");
  const outDir = join(outRoot, `${topicName}-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const variants = [requireString(config, "baseline"), requireString(config, "variant")];

  const { cases, tagFailureCount } = await buildImageCases(
    {
      endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
      tagModel: requireString(config, "tag_model"),
      baseSeed: requireNumber(config, "seed"),
      generationsPerCase: requireNumber(config, "generations_per_case"),
      characterCount: requireNumber(config, "characters"),
      timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    },
    (message) => console.error(`[eval] ${message}`),
  );
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(cases, null, 2));
  console.error(`[eval] 画像タグ: ${cases.length} ケース(タグの失敗 ${tagFailureCount})`);

  const records: ImageRecord[] = [];
  const summaries = [];
  for (const variant of variants) {
    const variantRecords = await runImageTrials(
      {
        variant,
        outDir,
        sdcppDir: join(imageEvalDir, `sdcpp-${sdcppTag}`),
        modelDir: join(imageEvalDir, "models"),
        containerImage: `keycheer-image-eval:${sdcppTag}`,
        loraName: requireString(config, "lora"),
        samplingMethod: requireString(config, "sampling_method"),
        cfgScale: requireNumber(config, "cfg_scale"),
        steps: requireNumber(config, "steps"),
        width: requireNumber(config, "width"),
        height: requireNumber(config, "height"),
        timeoutMsPerImage: requireNumber(config, "timeout_ms_per_image"),
      },
      cases,
      (record) => {
        appendFileSync(join(outDir, "records.jsonl"), `${JSON.stringify(record)}\n`);
        console.error(
          `[eval] ${variant}: ${record.character}-${record.kind}-t${record.trial} ` +
            `${record.failed ? "失敗" : `${Math.round(record.latencyMs / 1000)} 秒`}`,
        );
      },
    );
    records.push(...variantRecords);
    summaries.push(computeImageSummary(variant, variantRecords));
  }

  console.log(
    JSON.stringify(
      { topic: topicName, outDir, cases: cases.length, tagFailureCount, summaries },
      null,
      2,
    ),
  );
}

function requireList(config: FlatConfig, key: string): string[] {
  return requireString(config, key)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

type ProcessEvalMode = "main" | "probe" | "background";

// "00ff00" の形の色を読む
function parseHexColor(text: string): PaletteColor {
  if (!/^[0-9a-fA-F]{6}$/.test(text))
    throw new Error(`config.yaml: 色 ${text} が 6 桁の 16 進数でない`);
  return [0, 2, 4].map((i) => parseInt(text.slice(i, i + 2), 16)) as unknown as PaletteColor;
}

// 画像の作り方の比較(論点 0045)。作り方の比較はモデルごとに行う(モデルの比較は論点 0041)。
// mode:
//   main       … 本計測
//   probe      … 下絵から描き直す強さを決めるための試し(1 モデル・1 キャラ・1 試行。strength_candidates)
//   background … 抜く背景の色を決めるための試し(全モデル・全キャラ・1 試行・待機画像だけ。background_candidates)
async function runImageProcessEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
  mode: ProcessEvalMode,
): Promise<void> {
  const cacheRoot =
    process.env.KEYCHEER_MODEL_CACHE ?? join(homedir(), ".cache", "keycheer-models");
  const imageEvalDir = join(cacheRoot, "image-eval");
  const sdcppTag = requireString(config, "sdcpp_tag");
  const runLabel = config.run_label === undefined ? "" : `-${config.run_label}`;
  const outDir = join(
    outRoot,
    `${topicName}-${stamp}${mode === "main" ? "" : `-${mode}`}${runLabel}`,
  );
  mkdirSync(outDir, { recursive: true });
  const allModels = requireList(config, "models");
  const models = mode === "probe" ? allModels.slice(0, 1) : allModels;
  // 本計測でも強さを複数並べられる(待機画像は 1 回だけ作り、派生の画像を強さごとに作る)
  const strengths =
    mode === "background"
      ? []
      : requireList(config, mode === "probe" ? "strength_candidates" : "strength").map(Number);
  const loraName = requireString(config, "lora");
  const limits = {
    colorLimit: requireNumber(config, "color_limit"),
    minTransparentPct: requireNumber(config, "min_transparent_pct"),
    maxTransparentPct: requireNumber(config, "max_transparent_pct"),
    minBackgroundMatchPct: requireNumber(config, "min_background_match_pct"),
  };
  // 背景の候補。本計測と強さの試しは決めた 1 つ、背景の試しは候補を全部
  const backgrounds: { name: string; tag: string; color: PaletteColor | null }[] =
    mode === "background"
      ? requireList(config, "background_candidates").map((entry) => {
          const [name = "", hex = ""] = entry.split("=").map((part) => part.trim());
          return { name, tag: `${name} background`, color: parseHexColor(hex) };
        })
      : [
          {
            name: "",
            // 空でもよい(下地から描かせるときは背景の色を言葉で頼まない)
            tag: config.background_tag ?? "",
            // 抜く色を書かなければ、絵の縁から読む(1・2 回目の計測のやり方)
            color:
              config.background_color === undefined ? null : parseHexColor(config.background_color),
          },
        ];

  const built = await buildProcessCases(
    {
      endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
      tagModel: requireString(config, "tag_model"),
      baseSeed: requireNumber(config, "seed"),
      generationsPerCase: mode === "main" ? requireNumber(config, "generations_per_case") : 1,
      characterCount: mode === "probe" ? 1 : requireNumber(config, "characters"),
      timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
      fixedTags: requireString(config, "fixed_tags"),
      // 背景の試しでは置き場を残しておき、候補ごとに差し替える(画像タグを候補の数だけ作り直さない)
      backgroundTag: mode === "background" ? BACKGROUND_PLACEHOLDER : backgrounds[0]!.tag,
      loraName,
    },
    (message) => console.error(`[eval] ${message}`),
  );
  const { tagFailureCount } = built;
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(built.cases, null, 2));
  const addedPersonTagCount = built.cases.filter((c) => c.hasAddedPersonTag).length;
  console.error(
    `[eval] 画像タグ: ${built.cases.length} 組(タグの失敗 ${tagFailureCount}、人物のタグを足した組 ${addedPersonTagCount})`,
  );

  const summaries = [];
  for (const background of backgrounds) {
    // 背景の試しは候補ごとにフォルダを分ける(同じケースの名前がぶつかるため)
    const runDir = mode === "background" ? join(outDir, background.name) : outDir;
    mkdirSync(runDir, { recursive: true });
    const cases =
      mode === "background"
        ? built.cases.map((c) => ({
            ...c,
            idlePrompt: c.idlePrompt.replaceAll(BACKGROUND_PLACEHOLDER, background.tag),
            derivedPrompts: {},
          }))
        : built.cases;
    const label = mode === "background" ? `${background.name} ` : "";
    const records: ProcessRecord[] = [];
    for (const model of models) {
      const modelRecords = await runProcessTrials(
        {
          variant: model,
          outDir: runDir,
          sdcppDir: join(imageEvalDir, `sdcpp-${sdcppTag}`),
          modelDir: join(imageEvalDir, "models"),
          containerImage: `keycheer-image-eval:${sdcppTag}`,
          loraName,
          samplingMethod: requireString(config, "sampling_method"),
          cfgScale: requireNumber(config, "cfg_scale"),
          steps: requireNumber(config, "steps"),
          width: requireNumber(config, "width"),
          height: requireNumber(config, "height"),
          timeoutMsPerImage: requireNumber(config, "timeout_ms_per_image"),
          strengths,
          derivedSteps: requireNumber(config, "derived_steps"),
          idleSteps: requireNumber(config, "idle_steps"),
          idleStrength: requireNumber(config, "idle_strength"),
          idleCanvasColor:
            config.idle_canvas_color === undefined ? null : parseHexColor(config.idle_canvas_color),
          backgroundColor: background.color,
          backgroundTolerance: requireNumber(config, "background_tolerance"),
          colorLimit: limits.colorLimit,
          changedTolerance: requireNumber(config, "changed_tolerance"),
        },
        cases,
        (record) => {
          appendFileSync(join(runDir, "records.jsonl"), `${JSON.stringify(record)}\n`);
          console.error(
            `[eval] ${label}${model}: ${record.character}-${record.kind}-t${record.trial}` +
              `${record.strength === null ? "" : ` 強さ ${record.strength}`} ` +
              (record.failed
                ? "失敗"
                : `${Math.round(record.latencyMs / 1000)} 秒 透明 ${record.transparentRatioPct}% ` +
                  `${record.colorCount} 色 変化 ${record.changedFromIdlePct ?? "—"}% ` +
                  `縁の背景色 ${record.backgroundMatchPct ?? "—"}%`),
          );
        },
      );
      records.push(...modelRecords);
      // 強さごとに分けて集計する(待機画像はどの強さの集計にも入れる)。強さが無ければ待機画像だけ
      for (const strength of strengths.length === 0 ? [null] : strengths) {
        summaries.push(
          computeProcessSummary(
            `${label}${model}${strengths.length > 1 ? ` 強さ ${strength}` : ""}`,
            modelRecords.filter((r) => r.strength === null || r.strength === strength),
            limits,
          ),
        );
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        topic: topicName,
        outDir,
        mode,
        cases: built.cases.length,
        tagFailureCount,
        addedPersonTagCount,
        strengths,
        derivedSteps: requireNumber(config, "derived_steps"),
        summaries,
      },
      null,
      2,
    ),
  );
}

// 論点 0062:通常の応援と節目の応援の絵の違い。画像タグは 1 回だけ作り、案ごとに 3 枚を作って差を測る
// 応援種別の画像の計測(論点 0062 / 0065)で共通の、sd.cpp の起動と後処理の条件
function buildCheerTrialSettings(
  config: FlatConfig,
  outDir: string,
): Omit<ProcessTrialSettings, "variant"> {
  const cacheRoot =
    process.env.KEYCHEER_MODEL_CACHE ?? join(homedir(), ".cache", "keycheer-models");
  const imageEvalDir = join(cacheRoot, "image-eval");
  const sdcppTag = requireString(config, "sdcpp_tag");
  return {
    outDir,
    sdcppDir: join(imageEvalDir, `sdcpp-${sdcppTag}`),
    modelDir: join(imageEvalDir, "models"),
    containerImage: `keycheer-image-eval:${sdcppTag}`,
    loraName: requireString(config, "lora"),
    samplingMethod: requireString(config, "sampling_method"),
    cfgScale: requireNumber(config, "cfg_scale"),
    steps: requireNumber(config, "steps"),
    width: requireNumber(config, "width"),
    height: requireNumber(config, "height"),
    timeoutMsPerImage: requireNumber(config, "timeout_ms_per_image"),
    strengths: [requireNumber(config, "strength")],
    derivedSteps: requireNumber(config, "derived_steps"),
    idleSteps: requireNumber(config, "idle_steps"),
    idleStrength: requireNumber(config, "idle_strength"),
    idleCanvasColor: parseHexColor(requireString(config, "idle_canvas_color")),
    backgroundColor: null,
    backgroundTolerance: requireNumber(config, "background_tolerance"),
    colorLimit: requireNumber(config, "color_limit"),
    changedTolerance: requireNumber(config, "changed_tolerance"),
  };
}

async function runCheerImageEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
): Promise<void> {
  const outDir = join(outRoot, `${topicName}-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const variants = [requireString(config, "baseline"), ...requireList(config, "variants")];
  const unknown = variants.filter((v) => !isCheerImageVariant(v));
  if (unknown.length > 0) throw new Error(`知らない案: ${unknown.join(", ")}`);
  const model = requireString(config, "models");

  const built = await buildCheerTagCases(
    {
      endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
      tagModel: requireString(config, "tag_model"),
      baseSeed: requireNumber(config, "seed"),
      generationsPerCase: requireNumber(config, "generations_per_case"),
      characterCount: requireNumber(config, "characters"),
      timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    },
    (message) => console.error(`[eval] ${message}`),
  );
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(built.cases, null, 2));
  console.error(`[eval] 画像タグ: ${built.cases.length} 組(タグの失敗 ${built.tagFailureCount})`);

  const colorLimit = requireNumber(config, "color_limit");
  const changedTolerance = requireNumber(config, "changed_tolerance");
  const { records, differences } = await runCheerDifferenceTrials({
    variants: variants.filter(isCheerImageVariant),
    tagCases: built.cases,
    fixedTags: requireString(config, "fixed_tags"),
    poseSettings: {
      regularPoseTags: requireString(config, "regular_pose_tags"),
      milestonePoseTags: requireString(config, "milestone_pose_tags"),
      milestoneEffectTags: requireString(config, "milestone_effect_tags"),
    },
    model,
    trial: buildCheerTrialSettings(config, outDir),
    changedTolerance,
    onLog: (message) => console.error(`[eval] ${message}`),
  });

  console.log(
    JSON.stringify(
      {
        topic: topicName,
        outDir,
        model,
        cases: built.cases.length,
        tagFailureCount: built.tagFailureCount,
        differences: variants
          .filter(isCheerImageVariant)
          .map((variant) => computeCheerDifferenceSummary(variant, differences)),
        images: variants.map((variant) =>
          computeProcessSummary(
            variant,
            records.filter((r) => r.variant === variant),
            {
              colorLimit,
              minTransparentPct: requireNumber(config, "min_transparent_pct"),
              maxTransparentPct: requireNumber(config, "max_transparent_pct"),
              minBackgroundMatchPct: 0,
            },
          ),
        ),
      },
      null,
      2,
    ),
  );
}

// 論点 0063 / 0064:論点 0062 の計測で描いた絵を読み直し、後処理だけを変えて並べる(画像は描き直さない)
async function runPostProcessEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
): Promise<void> {
  const sourceRoot = requireString(config, "source_dir");
  const sourceDir = join(
    sourceRoot,
    requireString(config, "source_variant"),
    requireString(config, "source_model"),
  );
  // 組(キャラ・試行)は 0062 の画像タグの記録から引く。0062 と同じ組だけを並べる
  const cases = JSON.parse(readFileSync(join(sourceRoot, "cases.json"), "utf8")) as {
    character: string;
    trial: number;
  }[];
  const characters = [...new Set(cases.map((c) => c.character))];
  const trials = [...new Set(cases.map((c) => c.trial))];
  const variants = [requireString(config, "baseline"), ...requireList(config, "variants")];
  const tolerance = requireNumber(config, "background_tolerance");
  const colorLimit = requireNumber(config, "color_limit");

  let settingsOf: PostProcessRunInput["settingsOf"];
  if (config.axis === "background_removal") {
    const unknown = variants.filter((v) => !isBackgroundVariant(v));
    if (unknown.length > 0) throw new Error(`知らない案: ${unknown.join(", ")}`);
    const wide = requireNumber(config, "wide_background_tolerance");
    // 切り抜くモデルは、その案があるときだけ読み込む(置き場は scripts/fetch-seg-eval.sh)
    const segment = variants.includes("segment-u2netp")
      ? await createU2netSegmenter(
          process.env.KEYCHEER_SEG_EVAL_DIR ??
            join(homedir(), ".cache", "keycheer-models", "seg-eval"),
          requireString(config, "segment_model_file"),
        )
      : null;
    const threshold = variants.includes("segment-u2netp")
      ? requireNumber(config, "segment_threshold")
      : 0;
    settingsOf = (variant) => ({
      colorCount: colorLimit,
      cut:
        variant === "two-pass"
          ? (small) => applyTwoPassBackgroundRemoval(small, tolerance)
          : variant === "segment-u2netp"
            ? async (small, raw) =>
                applyProbabilityMask(
                  small,
                  await segment!(raw, small.width, small.height),
                  threshold,
                )
            : (small) =>
                applyBackgroundRemoval(small, variant === "wide-tolerance" ? wide : tolerance),
    });
  } else {
    const counts = variants.map(Number);
    if (counts.some((n) => !Number.isInteger(n) || n < 1)) {
      throw new Error(`色の数は 1 以上の整数: ${variants.join(", ")}`);
    }
    settingsOf = (variant) => ({
      colorCount: Number(variant),
      cut: (image) => applyBackgroundRemoval(image, tolerance),
    });
  }

  const outDir = join(outRoot, `${topicName}-${stamp}`);
  const summaries = await runPostProcessComparison({
    title: topicName,
    sourceDir,
    outDir,
    characters,
    trials,
    width: MAX_IMAGE_WIDTH,
    height: MAX_IMAGE_HEIGHT,
    variants,
    settingsOf,
    minTransparentPct: requireNumber(config, "min_transparent_pct"),
    maxTransparentPct: requireNumber(config, "max_transparent_pct"),
  });
  console.log(JSON.stringify({ topic: topicName, outDir, sourceDir, summaries }, null, 2));
}

// 論点 0065:案P1(論点 0062)のまま、避ける語と CFG を案ごとに変えて描き直す。画像タグは 1 回だけ作り、両案で同じものを使う
const BREAKAGE_VARIANTS = ["none", "negative"] as const;
// 塊として数える最小の画素数(256x384 の絵で、線のかけら・点を数えないため)
const MIN_BLOB_PIXELS = 200;

async function runNegativePromptEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
): Promise<void> {
  const outDir = join(outRoot, `${topicName}-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const variants = [requireString(config, "baseline"), ...requireList(config, "variants")];
  const unknown = variants.filter((v) => !(BREAKAGE_VARIANTS as readonly string[]).includes(v));
  if (unknown.length > 0) throw new Error(`知らない案: ${unknown.join(", ")}`);
  const model = requireString(config, "models");

  const built = await buildCheerTagCases(
    {
      endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
      tagModel: requireString(config, "tag_model"),
      baseSeed: requireNumber(config, "seed"),
      generationsPerCase: requireNumber(config, "generations_per_case"),
      characterCount: requireNumber(config, "characters"),
      timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    },
    (message) => console.error(`[eval] ${message}`),
  );
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(built.cases, null, 2));
  console.error(`[eval] 画像タグ: ${built.cases.length} 組(タグの失敗 ${built.tagFailureCount})`);

  const changedTolerance = requireNumber(config, "changed_tolerance");
  const results = [];
  for (const variant of variants) {
    const variantDir = join(outDir, variant);
    const base = buildCheerTrialSettings(config, variantDir);
    const trial =
      variant === "negative"
        ? {
            ...base,
            cfgScale: requireNumber(config, "negative_cfg_scale"),
            negativePrompt: requireString(config, "negative_prompt"),
          }
        : base;
    const { records } = await runCheerDifferenceTrials({
      variants: ["fixed-pose"],
      tagCases: built.cases,
      fixedTags: requireString(config, "fixed_tags"),
      poseSettings: {
        regularPoseTags: requireString(config, "regular_pose_tags"),
        milestonePoseTags: requireString(config, "milestone_pose_tags"),
        milestoneEffectTags: "",
      },
      model,
      trial,
      changedTolerance,
      onLog: (message) => console.error(`[eval] ${variant}: ${message}`),
    });
    const blobCounts = records
      .filter((r) => r.file !== null)
      .map((r) => ({
        file: `${variant}/${r.file}`,
        blobs: computeOpaqueBlobCount(
          decodePng(readFileSync(join(variantDir, r.file!))),
          MIN_BLOB_PIXELS,
        ),
      }));
    results.push({
      variant,
      images: computeProcessSummary(variant, records, {
        colorLimit: requireNumber(config, "color_limit"),
        minTransparentPct: requireNumber(config, "min_transparent_pct"),
        maxTransparentPct: requireNumber(config, "max_transparent_pct"),
        minBackgroundMatchPct: 0,
      }),
      meanBlobCount:
        Math.round((blobCounts.reduce((a, b) => a + b.blobs, 0) / blobCounts.length) * 10) / 10,
      multiBlobFiles: blobCounts.filter((b) => b.blobs > 1).map((b) => b.file),
    });
  }
  console.log(JSON.stringify({ topic: topicName, outDir, model, results }, null, 2));
}

// 論点 0067:CFG 1.5 + 避ける語(論点 0065)のまま、固定の語(fixed_tags_<案>)だけを案ごとに変えて描き直し、
// 0064 と同じ後処理(色で抜き 7 色に減らす)を当てて色相の偏りと肌の色の残りを測る。画像タグは 1 回だけ作り全案で同じものを使う
async function runColorTagsEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
): Promise<void> {
  const outDir = join(outRoot, `${topicName}-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const variants = [requireString(config, "baseline"), ...requireList(config, "variants")];
  const fixedTagsOf = new Map(variants.map((v) => [v, requireString(config, `fixed_tags_${v}`)]));
  const model = requireString(config, "models");

  const built = await buildCheerTagCases(
    {
      endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
      tagModel: requireString(config, "tag_model"),
      baseSeed: requireNumber(config, "seed"),
      generationsPerCase: requireNumber(config, "generations_per_case"),
      characterCount: requireNumber(config, "characters"),
      timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    },
    (message) => console.error(`[eval] ${message}`),
  );
  writeFileSync(join(outDir, "cases.json"), JSON.stringify(built.cases, null, 2));
  console.error(`[eval] 画像タグ: ${built.cases.length} 組(タグの失敗 ${built.tagFailureCount})`);

  const tolerance = requireNumber(config, "background_tolerance");
  const colorLimit = requireNumber(config, "color_limit");
  const results = [];
  for (const variant of variants) {
    const variantDir = join(outDir, variant);
    const { records } = await runCheerDifferenceTrials({
      variants: ["fixed-pose"],
      tagCases: built.cases,
      fixedTags: fixedTagsOf.get(variant)!,
      poseSettings: {
        regularPoseTags: requireString(config, "regular_pose_tags"),
        milestonePoseTags: requireString(config, "milestone_pose_tags"),
        milestoneEffectTags: "",
      },
      model,
      trial: {
        ...buildCheerTrialSettings(config, variantDir),
        negativePrompt: requireString(config, "negative_prompt"),
      },
      changedTolerance: requireNumber(config, "changed_tolerance"),
      onLog: (message) => console.error(`[eval] ${variant}: ${message}`),
    });
    const [post] = await runPostProcessComparison({
      title: `${topicName} ${variant}`,
      sourceDir: join(variantDir, "fixed-pose", model),
      outDir: join(outDir, "post", variant),
      characters: [...new Set(built.cases.map((c) => c.character))],
      trials: [...new Set(built.cases.map((c) => c.trial))],
      width: MAX_IMAGE_WIDTH,
      height: MAX_IMAGE_HEIGHT,
      variants: [variant],
      settingsOf: () => ({
        colorCount: colorLimit,
        cut: (small) => applyBackgroundRemoval(small, tolerance),
      }),
      minTransparentPct: requireNumber(config, "min_transparent_pct"),
      maxTransparentPct: requireNumber(config, "max_transparent_pct"),
    });
    const latencies = records.filter((r) => !r.failed).map((r) => r.latencyMs);
    results.push({
      variant,
      fixedTags: fixedTagsOf.get(variant),
      failed: records.filter((r) => r.failed).length,
      meanLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      post,
    });
  }
  console.log(JSON.stringify({ topic: topicName, outDir, model, results }, null, 2));
}

// 論点 0063 の案M1:0062 と同じ画像タグ・シードで、外側の帯だけを描かせずに描き直し、アプリと同じ後処理(今の抜き方)を当てる
async function runBandMaskEval(
  config: FlatConfig,
  topicName: string,
  outRoot: string,
  stamp: string,
): Promise<void> {
  const sourceRoot = requireString(config, "source_dir");
  const tagCases = JSON.parse(
    readFileSync(join(sourceRoot, "cases.json"), "utf8"),
  ) as CheerTagCase[];
  const outDir = join(outRoot, `${topicName}-mask-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const model = requireString(config, "source_model");
  const changedTolerance = requireNumber(config, "changed_tolerance");
  const { records } = await runCheerDifferenceTrials({
    variants: ["fixed-pose"],
    tagCases,
    fixedTags: requireString(config, "fixed_tags"),
    poseSettings: {
      regularPoseTags: requireString(config, "regular_pose_tags"),
      milestonePoseTags: requireString(config, "milestone_pose_tags"),
      milestoneEffectTags: "",
    },
    model,
    trial: {
      ...buildCheerTrialSettings(config, outDir),
      maskBandPx: requireNumber(config, "mask_band_px"),
    },
    changedTolerance,
    onLog: (message) => console.error(`[eval] mask: ${message}`),
  });
  const tolerance = requireNumber(config, "background_tolerance");
  const summaries = await runPostProcessComparison({
    title: `${topicName} M1`,
    sourceDir: join(outDir, "fixed-pose", model),
    outDir: join(outDir, "post"),
    characters: [...new Set(tagCases.map((c) => c.character))],
    trials: [...new Set(tagCases.map((c) => c.trial))],
    width: MAX_IMAGE_WIDTH,
    height: MAX_IMAGE_HEIGHT,
    variants: ["band-mask"],
    settingsOf: () => ({
      colorCount: requireNumber(config, "color_limit"),
      cut: (small) => applyBackgroundRemoval(small, tolerance),
    }),
    minTransparentPct: requireNumber(config, "min_transparent_pct"),
    maxTransparentPct: requireNumber(config, "max_transparent_pct"),
  });
  const latencies = records.filter((r) => !r.failed).map((r) => r.latencyMs);
  console.log(
    JSON.stringify(
      {
        topic: topicName,
        outDir,
        failed: records.filter((r) => r.failed).length,
        meanLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
        summaries,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const topicDir = process.argv[2];
  if (topicDir === undefined) throw new Error("論点フォルダを指定する: npm run eval -- <dir>");
  const config = parseFlatConfig(readFileSync(join(topicDir, "config.yaml"), "utf8"));

  const outDir = process.env.KEYCHEER_EVAL_OUT ?? join(homedir(), ".cache", "keycheer-eval");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (config.axis === "image_model") {
    await runImageModelEval(config, basename(topicDir), outDir, stamp);
    return;
  }
  if (config.axis === "cheer_image_tags") {
    await runCheerImageEval(config, basename(topicDir), outDir, stamp);
    return;
  }
  if (config.axis === "background_removal" && process.argv[3] === "mask") {
    await runBandMaskEval(config, basename(topicDir), outDir, stamp);
    return;
  }
  if (config.axis === "background_removal" || config.axis === "palette_size") {
    await runPostProcessEval(config, basename(topicDir), outDir, stamp);
    return;
  }
  if (config.axis === "color_tags") {
    await runColorTagsEval(config, basename(topicDir), outDir, stamp);
    return;
  }
  if (config.axis === "negative_prompt") {
    await runNegativePromptEval(config, basename(topicDir), outDir, stamp);
    return;
  }
  if (config.axis === "image_process") {
    const mode = process.argv[3] ?? "main";
    if (mode !== "main" && mode !== "probe" && mode !== "background") {
      throw new Error(`知らないモード: ${mode}(probe / background のどちらか。省くと本計測)`);
    }
    // 4 つ目以降の引数 `キー=値` で config.yaml の値を差し替える(値が空ならそのキーを消す)。
    // 同じ論点の中で、条件を 1 つだけ変えた組を並べて測るため。何を差し替えたかは result.md に書く
    for (const override of process.argv.slice(4)) {
      const eq = override.indexOf("=");
      if (eq <= 0) throw new Error(`差し替えは キー=値 で書く: ${override}`);
      const key = override.slice(0, eq);
      if (eq === override.length - 1) delete config[key];
      else config[key] = override.slice(eq + 1);
    }
    await runImageProcessEval(config, basename(topicDir), outDir, stamp, mode);
    return;
  }
  const outFile = join(outDir, `${basename(topicDir)}-${stamp}.jsonl`);

  const common: Omit<ComparisonSettings, keyof VariantSettings> = {
    endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
    baseSeed: requireNumber(config, "seed"),
    generationsPerCase: requireNumber(config, "generations_per_case"),
    timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    characterCount: requireNumber(config, "characters"),
  };
  // 案の名前を先に全部引く。未知の名前で 1 案目を測り終えてから落ちると、その計測が無駄になる
  const variants = buildVariants(config);

  const summaries = [];
  for (const variant of variants) {
    let done = 0;
    const records = await runTrials({ ...common, ...variant }, (record) => {
      appendFileSync(outFile, `${JSON.stringify(record)}\n`);
      done += 1;
      if (done % 24 === 0) console.error(`[eval] ${variant.variant}: ${done} buckets`);
    });
    summaries.push(computeSummary(variant.variant, records));
  }

  console.log(JSON.stringify({ topic: basename(topicDir), outFile, summaries }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
