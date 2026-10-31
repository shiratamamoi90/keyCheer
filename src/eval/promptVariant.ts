// promptVariant: プロンプト案を名前で引く(論点 0026)。論点の config.yaml の baseline / variant が名前を持つ。
//
// 案は eval 側で組み立て、アプリの buildSystemPrompt は計測中に変えない。決まった案をアプリへ
// 反映するのは決定後の作業(先に変えると、baseline が現行のプロンプトでなくなる)。
// 案は現行のプロンプトに足す形にする — 現行を組み直すと、比べたい 1 行以外の差が混ざる。

import { buildSystemPrompt, type CharacterProfile } from "../agent/poolGenerator.js";
import type { BucketKey } from "../core/messagePool.js";
import type { SpeedZone } from "../core/shared/types.js";

export type PromptBuilder = (
  character: CharacterProfile,
  scenarioKey: BucketKey,
  count: number,
) => string;

// 論点 0026 案A の文言(人間が確定 2026-10-25)。topic.md の引用の `` ` `` は表示用で、プロンプトには入れない
export const FORMAT_DIRECTIVE =
  "応援の文だけを書き、強調(**)・見出し(#)・番号・括弧の注記は付けないでください。";

// 論点 0021 で消す行の書き出し。現行の buildSystemPrompt の行と一致しなければ、消せないまま
// baseline と同じプロンプトを測ってしまうので、組み立てのたびに確かめる。
const ZONE_LINE_PREFIX = "速度ゾーンでテンション調整:";

function replaceZoneLine(prompt: string, replacement: string | null): string {
  const lines = prompt.split("\n");
  const index = lines.findIndex((line) => line.startsWith(ZONE_LINE_PREFIX));
  const matchCount = lines.filter((line) => line.startsWith(ZONE_LINE_PREFIX)).length;
  if (matchCount !== 1) {
    throw new Error(
      `プロンプトに「${ZONE_LINE_PREFIX}」の行がちょうど 1 行ない(ゾーンの行の案が組めない)`,
    );
  }
  const replaced = replacement === null ? [] : [replacement];
  return [...lines.slice(0, index), ...replaced, ...lines.slice(index + 1)].join("\n");
}

// 論点 0035 の文言。英語のゾーン名 slow / normal / fast をプロンプトに書かない — 現行の行では
// その名前が応援文に漏れた(論点 0021 の result.md)。そのバケットのゾーンだけを書き、3 つは並べない
export const ZONE_SENTENCES: Readonly<Record<SpeedZone, string>> = {
  slow: "いまは打つのがゆっくりなときです。寄り添うように応援してください。",
  normal: "いまはふつうの速さで打っているときです。いつもの調子で応援してください。",
  fast: "いまは速く打っているときです。勢いを煽るように応援してください。",
};

function resolveSpeedZone(scenarioKey: BucketKey): SpeedZone {
  return scenarioKey.split("_")[0] as SpeedZone;
}

const PROMPT_VARIANTS: Readonly<Record<string, PromptBuilder>> = {
  no_directive: buildSystemPrompt,
  format_directive: (character, scenarioKey, count) =>
    `${buildSystemPrompt(character, scenarioKey, count)}\n${FORMAT_DIRECTIVE}`,
  // 論点 0021:現行(ゾーンの行あり)と、その 1 行だけを消した案。バケットキーは両案とも渡す
  zone_line: buildSystemPrompt,
  no_zone_line: (character, scenarioKey, count) =>
    replaceZoneLine(buildSystemPrompt(character, scenarioKey, count), null),
  // 論点 0035:ゾーンの行を、そのバケットのゾーンだけを日本語で書いた 1 文に置き換える
  zone_sentence: (character, scenarioKey, count) =>
    replaceZoneLine(
      buildSystemPrompt(character, scenarioKey, count),
      ZONE_SENTENCES[resolveSpeedZone(scenarioKey)],
    ),
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
