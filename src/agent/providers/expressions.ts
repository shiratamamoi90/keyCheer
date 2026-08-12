// キャラ画像の表情差分タグ(通常 / 喜び / 激励)。
// 要件: docs/integrations.md「通常/喜び/激励の 3 枚を同一シード + 表情タグ差し替えで生成」
// ローカル(sd.cpp)と外部(DALL·E 等)で同じタグを使い、プロバイダーを変えても
// 生成される 3 枚の意味(imagePaths の normal / happy / excited)が揃うようにする。

export const EXPRESSION_TAGS = [
  "neutral expression",
  "happy, smiling",
  "excited, cheering",
] as const;

// i 枚目に使う表情タグ(枚数がタグ数を超えたら循環させる)
export function expressionTagAt(index: number, tags: readonly string[] = EXPRESSION_TAGS): string {
  return tags[index % tags.length]!;
}
