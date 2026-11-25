// textModelCheck: テキストモデルの GGUF を sha256 で照合する。
// 要件: docs/model-weights.md S0055_08・S0059_01〜04(論点 0059)
//
// 生成を始めるたびに照合する(S0059_02。前の結果を覚えて使わない — 生成の合間に壊れたものを見逃さないため)。
// 判定は置き場のファイルだけで行い、言語モデルのランタイムに問い合わせない(S0059_03)。ファイルは読むだけで書き換えない(S0059_04)。

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { TEXT_MODEL_FILE, TEXT_WEIGHTS_DIR } from "../core/shared/textModel.js";

export function resolveTextModelPath(userDataDir: string): string {
  return `${userDataDir}/${TEXT_WEIGHTS_DIR}/${TEXT_MODEL_FILE.file}`;
}

// 2 GB を一度に読み込まないよう、流しながら計算する
export function computeFileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// S0059_01 一致すれば生成を始めてよい / S0055_08 無い・一致しない・読めないときは false(クラッシュしない)
export async function isTextModelIntact(input: {
  path: string;
  expectedSha256: string;
  computeSha256: (path: string) => Promise<string>;
}): Promise<boolean> {
  if (!existsSync(input.path)) return false;
  try {
    return (await input.computeSha256(input.path)) === input.expectedSha256;
  } catch {
    return false;
  }
}
