// characterImage: キャラ画像の画像タグの要求・応答のパース・縮小後の大きさ。純粋関数のみ。
// spec: 論点 0036 / docs/integrations.md「画像タグの要求」/ docs/pool-generation.md「生成でキャラ画像も作る」
//
// 画像タグの良し悪し(セリフやキャラに合った絵になるか)は縛らない(非決定的)。ここが持つのは
// 要求に何を入れ何を入れないか、応答の形、保存する大きさ。
// 応援発動経路からは import しない(生成時だけの処理。core/index.ts にも再エクスポートしない)。

import { ALL_BUCKET_KEYS, computeCheerType, type MessagePool } from "./messagePool.js";
import type { CheerType } from "./shared/types.js";

// 1 キャラ 3 枚。idle = 待機画像、regular / milestone = その応援種別の画像(論点 0036)
export const CHARACTER_IMAGE_KINDS = ["idle", "regular", "milestone"] as const;
export type CharacterImageKind = (typeof CHARACTER_IMAGE_KINDS)[number];

export interface ImageTagCharacter {
  name: string;
  personality: string;
}

// 応答スキーマ(docs/integrations.md「画像タグの要求」)。3 実装で共通。
// トップレベルをオブジェクトにするのはセリフの応答スキーマと同じ理由(OpenAI strict / Anthropic tool 入力)。
export const IMAGE_TAG_RESPONSE_SCHEMA = {
  type: "object",
  properties: { tags: { type: "array", items: { type: "string" } } },
  required: ["tags"],
  additionalProperties: false,
} as const;

const KIND_LINE: Readonly<Record<CharacterImageKind, string>> = {
  idle: "セリフを話していないときの、ふだんの立ち絵です。",
  regular: "次のような応援のセリフを話しているときの立ち絵です。",
  milestone: "節目を達成したときに、次のようなセリフを話している立ち絵です。",
};

// S0036_01 画像 1 枚につき 1 回、画像タグを要求する — 要求の中身
// S0036_02 待機画像の要求にセリフを入れない
// S0036_03 応援種別の画像の要求にほかの応援種別のセリフを入れない
//
// なぜ待機画像にセリフを入れないか:待機画像は応援が出ていないときの絵で、特定のセリフの表情に
// 寄せると「応援していないのに応援している絵」になる。応援種別ごとに分けるのは、milestone の
// 祝う表情が regular の絵に混ざらないようにするため。
export function buildImageTagPrompt(
  character: ImageTagCharacter,
  kind: CharacterImageKind,
  pool: MessagePool,
): string {
  const lines = [
    "あなたは画像生成用のタグを考えます。",
    `キャラクター: ${character.name}`,
    `性格: ${character.personality}`,
    KIND_LINE[kind],
  ];
  if (kind !== "idle") {
    for (const text of selectMessageTexts(pool, kind)) lines.push(`- ${text}`);
  }
  lines.push(
    "このキャラクターの立ち絵を描くための、表情・ポーズ・雰囲気を表す英語の短いタグを返してください。",
  );
  return lines.join("\n");
}

function selectMessageTexts(pool: MessagePool, type: CheerType): string[] {
  return ALL_BUCKET_KEYS.filter((key) => computeCheerType(key) === type).flatMap((key) =>
    pool.buckets[key].map((m) => m.text),
  );
}

// Ollama / OpenAI は JSON 文字列、Anthropic の tool_use.input は解析済みのオブジェクトで返る
function parsePayload(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof raw !== "string") return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function normalizedTags(tags: readonly string[]): string[] {
  return tags.map((t) => t.trim()).filter((t) => t.length > 0);
}

// S0036_05 画像タグの形式違反はその画像だけ失敗にする — ここは検出だけ。失敗への落とし方は呼び出し側
export function validateImageTagResponse(raw: unknown): string[] {
  const parsed = parsePayload(raw);
  if (!parsed.ok) return ["image tag response is not valid JSON"];
  const value = parsed.value;
  if (typeof value !== "object" || value === null) return ["image tag response is not an object"];
  const tags = (value as Record<string, unknown>).tags;
  if (tags === undefined) return ["image tag response has no tags"];
  if (!Array.isArray(tags)) return ["image tag response tags is not an array"];
  if (!tags.every((t) => typeof t === "string")) {
    return ["image tag response tags contains a non-string element"];
  }
  if (normalizedTags(tags).length === 0) return ["image tag response has no usable tag"];
  return [];
}

// S0036_04 画像タグを連結してプロンプトにする
// validateImageTagResponse が空を返した応答だけを渡す前提(形の検査をここで繰り返さない)。
export function buildImageTagText(raw: unknown): string {
  const parsed = parsePayload(raw);
  const tags = parsed.ok ? (parsed.value as { tags: string[] }).tags : [];
  return normalizedTags(tags).join(", ");
}

// S0036_15 縮小して PNG で保存する — 保存する大きさ
// 出典は論点 0036(256x384。縦長の窓に立ち絵がおさまる大きさ)。データ量を抑えるための上限で、
// 生成の大きさ(system.imageGen の 512x768)とは別。小さい画像を拡大しないのは、データ量が増えるだけで
// 細部は戻らないため。
export const MAX_IMAGE_WIDTH = 256;
export const MAX_IMAGE_HEIGHT = 384;

export function computeImageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
