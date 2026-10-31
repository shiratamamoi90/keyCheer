// promptVariant: プロンプト案を名前で引く(論点 0026)。論点の config.yaml の baseline / variant が名前を持つ。
//
// 案は eval 側で組み立て、アプリの buildSystemPrompt は計測中に変えない。決まった案をアプリへ
// 反映するのは決定後の作業(先に変えると、baseline が現行のプロンプトでなくなる)。
// 案は現行のプロンプトに足す形にする — 現行を組み直すと、比べたい 1 行以外の差が混ざる。

import {
  buildSystemPrompt,
  SPEED_ZONE_SENTENCES,
  type CharacterProfile,
} from "../agent/poolGenerator.js";
import type { BucketKey } from "../core/messagePool.js";

export type PromptBuilder = (
  character: CharacterProfile,
  scenarioKey: BucketKey,
  count: number,
) => string;

// 論点 0026 案A の文言(人間が確定 2026-10-25)。topic.md の引用の `` ` `` は表示用で、プロンプトには入れない
export const FORMAT_DIRECTIVE =
  "応援の文だけを書き、強調(**)・見出し(#)・番号・括弧の注記は付けないでください。";

// 論点 0035 より前の buildSystemPrompt の最後の行。論点 0021 / 0026 / 0035 の baseline はこの行を持つ
// プロンプトで測った。baseline は固定する決まり(@.claude/rules/experiment-rules.md)なので、アプリの
// プロンプトが変わった後も、ここで旧プロンプトを組み直して過去の計測を再現できるようにしておく。
const LEGACY_ZONE_LINE =
  "速度ゾーンでテンション調整: slow=寄り添う / normal=標準 / fast=勢いを煽る";

// 現行の最後の行(速度ゾーンの文)を差し替える。差し替える行が速度ゾーンの文でなければ、
// 旧プロンプトを組めないまま別のプロンプトを測ってしまうので止める。
function replaceLastLine(prompt: string, replacement: string | null): string {
  const lines = prompt.split("\n");
  const last = lines.at(-1) ?? "";
  if (!Object.values(SPEED_ZONE_SENTENCES).includes(last)) {
    throw new Error("プロンプトの最後の行が速度ゾーンの文ではない(旧プロンプトを組めない)");
  }
  return [...lines.slice(0, -1), ...(replacement === null ? [] : [replacement])].join("\n");
}

const buildLegacySystemPrompt: PromptBuilder = (character, scenarioKey, count) =>
  replaceLastLine(buildSystemPrompt(character, scenarioKey, count), LEGACY_ZONE_LINE);

const PROMPT_VARIANTS: Readonly<Record<string, PromptBuilder>> = {
  no_directive: buildLegacySystemPrompt,
  format_directive: (character, scenarioKey, count) =>
    `${buildLegacySystemPrompt(character, scenarioKey, count)}\n${FORMAT_DIRECTIVE}`,
  // 論点 0021:旧プロンプト(ゾーンの行あり)と、その 1 行だけを消した案。バケットキーは両案とも渡す
  zone_line: buildLegacySystemPrompt,
  no_zone_line: (character, scenarioKey, count) =>
    replaceLastLine(buildSystemPrompt(character, scenarioKey, count), null),
  // 論点 0035:そのバケットの速度ゾーンだけを日本語の 1 文で書く(採用し、現行の buildSystemPrompt になった)
  zone_sentence: buildSystemPrompt,
};

export function resolvePromptBuilder(name: string): PromptBuilder {
  const builder = PROMPT_VARIANTS[name];
  if (builder === undefined) {
    throw new Error(
      `config.yaml: プロンプト案 ${name} は無い(${Object.keys(PROMPT_VARIANTS).join(" / ")})`,
    );
  }
  return builder;
}
