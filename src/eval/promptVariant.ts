// promptVariant: プロンプト案を名前で引く(論点 0026)。論点の config.yaml の baseline / variant が名前を持つ。
//
// 案は eval 側で組み立て、アプリの buildSystemPrompt は計測中に変えない。決まった案をアプリへ
// 反映するのは決定後の作業(先に変えると、baseline が現行のプロンプトでなくなる)。
// 案は現行のプロンプトに足す形にする — 現行を組み直すと、比べたい 1 行以外の差が混ざる。

import { buildSystemPrompt, type CharacterProfile } from "../agent/poolGenerator.js";
import type { BucketKey } from "../core/messagePool.js";

export type PromptBuilder = (
  character: CharacterProfile,
  scenarioKey: BucketKey,
  count: number,
) => string;

// 論点 0026 案A の文言(人間が確定 2026-10-25)。topic.md の引用の `` ` `` は表示用で、プロンプトには入れない
export const FORMAT_DIRECTIVE =
  "応援の文だけを書き、強調(**)・見出し(#)・番号・括弧の注記は付けないでください。";

const PROMPT_VARIANTS: Readonly<Record<string, PromptBuilder>> = {
  no_directive: buildSystemPrompt,
  format_directive: (character, scenarioKey, count) =>
    `${buildSystemPrompt(character, scenarioKey, count)}\n${FORMAT_DIRECTIVE}`,
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
