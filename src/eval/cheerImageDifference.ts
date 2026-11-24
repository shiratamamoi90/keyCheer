// cheerImageDifference: 通常の応援(regular)と節目の応援(milestone)の絵の違いを大きくする計測(論点 0062)。
//
// 振る変数は「応援種別の画像の、表情・ポーズの画像タグの決め方」の 1 つ:
//   model-pose(baseline)… 今のアプリと同じ。テキストモデルが表情とポーズを 2〜4 個返す
//   fixed-pose          … テキストモデルは表情だけを返し、ポーズは応援種別ごとに決めた語を足す
//   fixed-pose-effects  … fixed-pose に、節目の応援だけ演出の語(きらきら・紙吹雪など)を足す
// それ以外(モデル・下絵・強さ・ステップ数・背景の抜き方・減色)は論点 0045 の作り方のまま(runProcessTrials を使う)。
// 見た目と表情の画像タグは 1 回だけ作り、3 案で同じものを使う(違いが画像タグの決め方だけから出るように)。
//
// 絵の良し悪しは指標で決めない。regular と milestone の差(変わった画素の割合・人物の外形の重なり)を数で出し、
// 並べて見る頁で人間が判断する。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePool } from "../agent/poolGenerator.js";
import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import {
  buildImageTagText,
  validateImageTagResponse,
  type ImageTagCharacter,
} from "../core/characterImage.js";
import { ALL_BUCKET_KEYS, computeCheerType, type MessagePool } from "../core/messagePool.js";
import { escapeHtml } from "./imageModelComparison.js";
import {
  buildAppearanceTagPrompt,
  buildPoseTagPrompt,
  buildProcessPrompt,
  computeChangedRatioPct,
  runProcessTrials,
  type DerivedImageKind,
  type ProcessCase,
  type ProcessRecord,
  type ProcessTrialSettings,
} from "./imageProcessComparison.js";
import { decodePng, type RgbaImage } from "./png.js";
import { EVAL_CHARACTERS } from "./textModelComparison.js";

export const CHEER_IMAGE_VARIANTS = ["model-pose", "fixed-pose", "fixed-pose-effects"] as const;
export type CheerImageVariant = (typeof CHEER_IMAGE_VARIANTS)[number];

const DERIVED_KINDS: readonly DerivedImageKind[] = ["regular", "milestone"];
const RGBA_BYTES = 4;
// 背景を抜いた後、この濃さ以上の画素を人物とみなす(imageProcessComparison の減色と同じ境)
const MIN_OPAQUE_ALPHA = 128;

export function isCheerImageVariant(value: string): value is CheerImageVariant {
  return (CHEER_IMAGE_VARIANTS as readonly string[]).includes(value);
}

const EXPRESSION_KIND_LINE: Readonly<Record<DerivedImageKind, string>> = {
  regular: "次のような応援の言葉を話しているときの立ち絵です。",
  milestone: "節目を達成したときに、次のような言葉を話している立ち絵です。",
};

// 表情だけの画像タグの要求(fixed-pose / fixed-pose-effects)。ポーズはアプリが足すので訊かない。
// 訊くと、足したポーズの語と食い違う語(arms crossed など)が混ざり、どちらの絵か分からなくなる。
export function buildExpressionTagPrompt(
  character: ImageTagCharacter,
  kind: DerivedImageKind,
  pool: MessagePool,
): string {
  const texts = ALL_BUCKET_KEYS.filter((key) => computeCheerType(key) === kind).flatMap((key) =>
    pool.buckets[key].map((m) => m.text),
  );
  return [
    "あなたは画像生成用のタグを考えます。",
    `キャラクター: ${character.name}`,
    `性格: ${character.personality}`,
    EXPRESSION_KIND_LINE[kind],
    ...texts.map((text) => `- ${text}`),
    "このときの表情だけを、アニメ絵の画像生成で使う英語のタグで 1〜2 個返してください。",
    "それぞれ小文字の英語 1〜3 語で書きます。ポーズ・髪・目・服は書かないでください。",
    "例: smile, open mouth",
  ].join("\n");
}

export interface CheerPoseSettings {
  regularPoseTags: string;
  milestonePoseTags: string;
  milestoneEffectTags: string;
}

// 案ごとの、応援種別の画像の表情・ポーズの画像タグ。
// fixed-pose で表情を先に置くのは、ポーズの語より先に読ませて顔を崩さないため(SD のプロンプトは前ほど効く)。
export function buildCheerPoseTags(input: {
  variant: CheerImageVariant;
  kind: DerivedImageKind;
  modelPoseTags: string;
  expressionTags: string;
  settings: CheerPoseSettings;
}): string {
  if (input.variant === "model-pose") return input.modelPoseTags;
  const pose =
    input.kind === "regular" ? input.settings.regularPoseTags : input.settings.milestonePoseTags;
  const effects =
    input.variant === "fixed-pose-effects" && input.kind === "milestone"
      ? input.settings.milestoneEffectTags
      : "";
  return [input.expressionTags, pose, effects].filter((part) => part.trim().length > 0).join(", ");
}

// 2 枚の人物の外形(背景を抜いた後の不透明な画素)の重なり。100 = 同じ形、0 = まったく重ならない。
// 両方とも人物が無ければ比べられないので null
export function computeMaskOverlapPct(a: RgbaImage, b: RgbaImage): number | null {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("大きさの違う画像は比べられない");
  }
  let both = 0;
  let either = 0;
  for (let offset = 0; offset < a.pixels.length; offset += RGBA_BYTES) {
    const isA = a.pixels[offset + 3]! >= MIN_OPAQUE_ALPHA;
    const isB = b.pixels[offset + 3]! >= MIN_OPAQUE_ALPHA;
    if (isA && isB) both += 1;
    if (isA || isB) either += 1;
  }
  return either === 0 ? null : Math.round((both / either) * 1000) / 10;
}

export interface CheerDifferenceRecord {
  variant: CheerImageVariant;
  character: string;
  trial: number;
  // regular と milestone の、背景を抜く前の画素で変わった割合(大きいほど違う)
  changedPct: number | null;
  // regular と milestone の人物の外形の重なり(小さいほどポーズが違う)
  maskOverlapPct: number | null;
}

export interface CheerDifferenceSummary {
  variant: CheerImageVariant;
  pairCount: number;
  meanChangedPct: number | null;
  meanMaskOverlapPct: number | null;
}

function computeMean(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return Math.round((present.reduce((sum, v) => sum + v, 0) / present.length) * 10) / 10;
}

export function computeCheerDifferenceSummary(
  variant: CheerImageVariant,
  records: readonly CheerDifferenceRecord[],
): CheerDifferenceSummary {
  const own = records.filter((r) => r.variant === variant);
  return {
    variant,
    pairCount: own.filter((r) => r.changedPct !== null).length,
    meanChangedPct: computeMean(own.map((r) => r.changedPct)),
    meanMaskOverlapPct: computeMean(own.map((r) => r.maskOverlapPct)),
  };
}

// 同じキャラ・試行を 1 行にし、案ごとに「待機・通常・節目」の 3 枚(後処理の後)を並べる。
// プロンプトはモデルが出した画像タグを含むので、頁に埋める前に必ずエスケープする。
export function buildCheerDifferencePage(input: {
  variants: readonly CheerImageVariant[];
  records: readonly ProcessRecord[];
  differences: readonly CheerDifferenceRecord[];
}): string {
  const keys = [...new Set(input.records.map((r) => `${r.character}\u0000${r.trial}`))];
  const rows = keys.map((key) => {
    const [character = "", trialText = "0"] = key.split("\u0000");
    const trial = Number(trialText);
    const cells = input.variants.map((variant) => {
      const own = input.records.filter(
        (r) => r.variant === variant && r.character === character && r.trial === trial,
      );
      const figures = (["idle", "regular", "milestone"] as const).map((kind) => {
        const record = own.find((r) => r.kind === kind);
        if (record === undefined) return "<figure>未計測</figure>";
        if (record.failed || record.file === null) {
          return `<figure>失敗<figcaption>${escapeHtml(record.error ?? "")}</figcaption></figure>`;
        }
        const tags = kind === "idle" ? "" : `<br><small>${escapeHtml(record.prompt)}</small>`;
        return `<figure><img src="${record.file.split("/").map(encodeURIComponent).join("/")}" width="192" alt=""><figcaption>${kind}${tags}</figcaption></figure>`;
      });
      const diff = input.differences.find(
        (d) => d.variant === variant && d.character === character && d.trial === trial,
      );
      const metric =
        diff === undefined
          ? ""
          : `<p>変化 ${diff.changedPct ?? "—"}% / 外形の重なり ${diff.maskOverlapPct ?? "—"}%</p>`;
      return `<td>${figures.join("")}${metric}</td>`;
    });
    return `<tr><th>${escapeHtml(character)}<br>試行 ${trial}</th>${cells.join("")}</tr>`;
  });
  const head = input.variants.map((v) => `<th>${escapeHtml(v)}</th>`).join("");
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8"><title>通常と節目の絵の違い(論点 0062)</title>',
    "<style>body{font-family:sans-serif}table{border-collapse:collapse}th,td{border:1px solid #999;padding:8px;vertical-align:top}th{text-align:left;font-weight:normal}figure{display:inline-block;margin:0 8px 0 0;max-width:200px}figcaption{font-size:small;word-break:break-word}img{background:repeating-conic-gradient(#bbb 0% 25%,#eee 0% 50%) 0 0/24px 24px}</style>",
    "</head><body><table>",
    `<tr><th>ケース</th>${head}</tr>`,
    ...rows,
    "</table></body></html>",
  ].join("\n");
}

// --- 計測の実行(ここから下は I/O) ---

export interface CheerTagCase {
  character: string;
  trial: number;
  seed: number;
  appearanceTags: string;
  // 種類ごとの画像タグ。取れなかった種類は持たない
  modelPoseTags: Partial<Record<DerivedImageKind, string>>;
  expressionTags: Partial<Record<DerivedImageKind, string>>;
}

export interface CheerTagSettings {
  endpoint: string;
  tagModel: string;
  baseSeed: number;
  generationsPerCase: number;
  characterCount: number;
  timeoutMsPerBucket: number;
}

// 画像タグを全ケース分、1 回だけ作る(3 案で共有する)
export async function buildCheerTagCases(
  settings: CheerTagSettings,
  onProgress: (message: string) => void,
): Promise<{ cases: CheerTagCase[]; tagFailureCount: number }> {
  const generator = createOllamaTextGenerator({
    endpoint: settings.endpoint,
    model: settings.tagModel,
  });
  const requestTags = async (prompt: string, seed: number): Promise<string | null> => {
    try {
      const raw = await generator.generateImageTags({
        prompt,
        seed,
        timeoutMs: settings.timeoutMsPerBucket,
      });
      return validateImageTagResponse(raw).length > 0 ? null : buildImageTagText(raw);
    } catch {
      return null;
    }
  };

  const cases: CheerTagCase[] = [];
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
      const appearanceTags = await requestTags(buildAppearanceTagPrompt(character), seed);
      if (appearanceTags === null) {
        tagFailureCount += 1;
        continue;
      }
      const modelPoseTags: Partial<Record<DerivedImageKind, string>> = {};
      const expressionTags: Partial<Record<DerivedImageKind, string>> = {};
      for (const kind of DERIVED_KINDS) {
        const pose = await requestTags(buildPoseTagPrompt(character, kind, state.pool), seed);
        if (pose === null) tagFailureCount += 1;
        else modelPoseTags[kind] = pose;
        const expression = await requestTags(
          buildExpressionTagPrompt(character, kind, state.pool),
          seed,
        );
        if (expression === null) tagFailureCount += 1;
        else expressionTags[kind] = expression;
      }
      cases.push({
        character: character.name,
        trial,
        seed,
        appearanceTags,
        modelPoseTags,
        expressionTags,
      });
    }
  }
  return { cases, tagFailureCount };
}

export function buildVariantCases(input: {
  variant: CheerImageVariant;
  tagCases: readonly CheerTagCase[];
  fixedTags: string;
  loraName: string;
  settings: CheerPoseSettings;
}): ProcessCase[] {
  return input.tagCases.map((tagCase) => {
    const derivedPrompts: Partial<Record<DerivedImageKind, string>> = {};
    for (const kind of DERIVED_KINDS) {
      const modelPoseTags = tagCase.modelPoseTags[kind];
      const expressionTags = tagCase.expressionTags[kind];
      const source = input.variant === "model-pose" ? modelPoseTags : expressionTags;
      if (source === undefined) continue;
      derivedPrompts[kind] = buildProcessPrompt({
        fixedTags: input.fixedTags,
        backgroundTag: "",
        appearanceTags: tagCase.appearanceTags,
        poseTags: buildCheerPoseTags({
          variant: input.variant,
          kind,
          modelPoseTags: modelPoseTags ?? "",
          expressionTags: expressionTags ?? "",
          settings: input.settings,
        }),
        loraName: input.loraName,
      });
    }
    return {
      character: tagCase.character,
      trial: tagCase.trial,
      seed: tagCase.seed,
      idlePrompt: buildProcessPrompt({
        fixedTags: input.fixedTags,
        backgroundTag: "",
        appearanceTags: tagCase.appearanceTags,
        poseTags: "",
        loraName: input.loraName,
      }),
      derivedPrompts,
      hasAddedPersonTag: !/\b1(girl|boy)\b/.test(tagCase.appearanceTags),
    };
  });
}

function loadImage(outDir: string, file: string | null): RgbaImage | null {
  if (file === null) return null;
  try {
    return decodePng(readFileSync(join(outDir, file)));
  } catch {
    return null;
  }
}

// 案ごとに 3 枚ずつ作り、regular と milestone の差を測る。案が 1 つ終わるたびに頁と記録を書き直す
export async function runCheerDifferenceTrials(input: {
  variants: readonly CheerImageVariant[];
  tagCases: readonly CheerTagCase[];
  fixedTags: string;
  poseSettings: CheerPoseSettings;
  // ベースモデルの置き場の名前(<modelDir>/<model>.safetensors)。振らないので 1 つ
  model: string;
  trial: Omit<ProcessTrialSettings, "variant">;
  changedTolerance: number;
  onLog: (message: string) => void;
}): Promise<{ records: ProcessRecord[]; differences: CheerDifferenceRecord[] }> {
  const records: ProcessRecord[] = [];
  const differences: CheerDifferenceRecord[] = [];
  const outDir = input.trial.outDir;
  for (const variant of input.variants) {
    const cases = buildVariantCases({
      variant,
      tagCases: input.tagCases,
      fixedTags: input.fixedTags,
      loraName: input.trial.loraName,
      settings: input.poseSettings,
    });
    // sd.cpp の実行はモデルの名前を variant に取るので、案ごとにフォルダを分けてモデルの名前で回し、記録を案の名前に戻す
    const variantDir = join(outDir, variant);
    mkdirSync(variantDir, { recursive: true });
    const relocate = (file: string | null): string | null =>
      file === null ? null : `${variant}/${file}`;
    const own: ProcessRecord[] = [];
    await runProcessTrials(
      { ...input.trial, outDir: variantDir, variant: input.model },
      cases,
      (produced) => {
        const record: ProcessRecord = {
          ...produced,
          variant,
          file: relocate(produced.file),
          rawFile: relocate(produced.rawFile),
        };
        own.push(record);
        appendFileSync(join(outDir, "records.jsonl"), `${JSON.stringify(record)}\n`);
        input.onLog(
          `${variant}: ${record.character}-${record.kind}-t${record.trial} ` +
            (record.failed ? "失敗" : `${Math.round(record.latencyMs / 1000)} 秒`),
        );
      },
    );
    records.push(...own);
    for (const c of cases) {
      const find = (kind: DerivedImageKind) =>
        own.find((r) => r.character === c.character && r.trial === c.trial && r.kind === kind);
      const regular = find("regular");
      const milestone = find("milestone");
      const regularRaw = loadImage(outDir, regular?.rawFile ?? null);
      const milestoneRaw = loadImage(outDir, milestone?.rawFile ?? null);
      const regularCut = loadImage(outDir, regular?.file ?? null);
      const milestoneCut = loadImage(outDir, milestone?.file ?? null);
      differences.push({
        variant,
        character: c.character,
        trial: c.trial,
        changedPct:
          regularRaw === null || milestoneRaw === null
            ? null
            : computeChangedRatioPct(regularRaw, milestoneRaw, input.changedTolerance),
        maskOverlapPct:
          regularCut === null || milestoneCut === null
            ? null
            : computeMaskOverlapPct(regularCut, milestoneCut),
      });
    }
    writeFileSync(
      join(outDir, "index.html"),
      buildCheerDifferencePage({ variants: input.variants, records, differences }),
    );
  }
  return { records, differences };
}
