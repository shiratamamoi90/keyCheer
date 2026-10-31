// hasCharacter: キャラクター「作成済み」判定。
// spec: docs/data-model.md「`hasCharacter` の判定」(論点 0032)
// 純粋関数のみ。`characters` が 1 件以上なら作成済み。
//
// 各キャラクターは保存時に必須項目を検証済み(main/characterInput.ts)なので件数だけを見る。
// 使用中のキャラクター・プール・画像の有無は含めない — 含めると生成が済むまで永久に「未作成」となり、
// 起動のたびにメインウィンドウが自動表示されてしまう(論点 0019 で画像を外したのと同じ理由)。

import type { Character } from "./shared/types.js";

export function hasCharacter(characters: readonly Character[] | undefined): boolean {
  return characters !== undefined && characters.length > 0;
}
