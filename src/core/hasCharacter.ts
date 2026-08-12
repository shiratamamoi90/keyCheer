// hasCharacter: キャラクター「作成済み」判定。
// spec: 論点 0019
//       「プロフィールが揃っていれば作成済みとする」「画像が無くても作成済みと判定する [境界]」
// 純粋関数のみ。判定対象は**プロフィール**(name/personality 非空文字列、voicevoxSpeakerId が数値)のみ。
//
// 0008 では imagePaths も必須にしていたが 0010 で外した。画像生成は別の論点 のため、
// 必須のままだと画像を作るまで永久に「未作成」となり、起動のたびにメインウィンドウが
// 自動表示されてしまうため。プール・wav・画像の有無は「作成済みか」とは別軸で扱う
// (プールがあればその文言、無ければ baseline 定型文で応援する)。

import type { Character } from "./shared/types.js";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function hasCharacter(character: Partial<Character> | undefined): boolean {
  if (character === undefined) return false;
  return (
    isNonEmptyString(character.name) &&
    isNonEmptyString(character.personality) &&
    typeof character.voicevoxSpeakerId === "number"
  );
}
