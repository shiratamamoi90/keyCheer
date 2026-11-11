// generationMode: 生成を始めたときに、再開するか作り直すかを決める。純粋関数のみ。
// spec: docs/pool-generation.md「生成を始めたときに、再開するか作り直すかを決める」(論点 0038)
//
// 利用者に選ばせず、保存されている状態から一意に決める(論点 0038 案A)。
// 判定に使うのはテキストの completion と「生成後にプロフィールを変えた」だけ。
// wav・画像の欠けは使わない(S0038_06。欠けた分だけ補う操作は論点 0039)。

import { hasProfileChangedSinceGeneration } from "./generatedProfile.js";
import type { GeneratedProfile } from "./shared/types.js";

// resume = 未完了分から続ける / rebuild = 既存のプールを捨てて最初から作る
export type GenerationMode = "resume" | "rebuild";

export interface GenerationModeInput {
  completion: Readonly<Record<string, "complete" | "pending" | "failed">>;
  profile: GeneratedProfile;
  generatedProfile: GeneratedProfile | undefined;
}

export function resolveGenerationMode(input: GenerationModeInput): GenerationMode {
  // S0038_03 生成後にプロフィールを変えていれば、未完了でも作り直す [境界]
  // 古いプロフィールで作った前半を残すと、1 キャラのセリフが 2 人分混ざる(S0036_13 と同じ理由)。
  // S0038_04 比べる元が無ければ「変えた」と判定しない(hasProfileChangedSinceGeneration が持つ)。
  if (hasProfileChangedSinceGeneration(input.profile, input.generatedProfile)) return "rebuild";

  // S0038_01 未完了のバケットが残っていれば再開する
  // S0038_02 全バケットが揃っていれば最初から作り直す
  const statuses = Object.values(input.completion);
  const isAllComplete = statuses.length > 0 && statuses.every((status) => status === "complete");
  return isAllComplete ? "rebuild" : "resume";
}
