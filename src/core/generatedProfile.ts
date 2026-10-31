// generatedProfile: 生成後にプロフィールを変えたかの判定。
// spec: docs/pool-generation.md「複数のキャラクターがあるときの生成」(論点 0032)
// 純粋関数のみ。比べる元は pool.json の generatedProfile(docs/data-model.md「メッセージプール」)。

import type { GeneratedProfile } from "./shared/types.js";

// S0032_22 生成後にプロフィールを変えたことが分かる
// 編集の履歴ではなく今の値どうしを比べる — 元の値に戻したら「変えた」と判定しないため。
// 判定しても生成物は消さない(編集で生成物を残す = S0032_04)。使うかどうかは利用者が決める。
export function hasProfileChangedSinceGeneration(
  profile: GeneratedProfile,
  generatedProfile: GeneratedProfile | undefined,
): boolean {
  // S0032_23 生成時のプロフィールを持たないプールは「変えた」と判定しない [境界]
  // 比べる元が無いのに「変えた」と出すと、旧いプールがすべて作り直しを促されてしまう。
  if (generatedProfile === undefined) return false;
  return (
    profile.name !== generatedProfile.name ||
    profile.personality !== generatedProfile.personality ||
    profile.voicevoxSpeakerId !== generatedProfile.voicevoxSpeakerId
  );
}
