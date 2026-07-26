// hasCharacter: キャラクター「作成済み」判定。
// spec: changes/0008-main-window-character-creation/spec.md
//       「hasCharacter は必須フィールドの充足で判定する [境界]」
// 純粋関数のみ。必須フィールド(name/personality 非空文字列、imagePaths/voicevoxSpeakerId 存在)を満たすときのみ true。

import type { Character } from "../shared/types.js";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function hasCharacter(character: Partial<Character> | undefined): boolean {
  if (character === undefined) return false;
  return (
    isNonEmptyString(character.name) &&
    isNonEmptyString(character.personality) &&
    character.imagePaths !== undefined &&
    typeof character.voicevoxSpeakerId === "number"
  );
}
