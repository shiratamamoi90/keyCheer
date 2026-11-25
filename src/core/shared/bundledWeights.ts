// bundledWeights: 配布物の重みの別ファイルの一覧(論点 0055 / 0072)。
// 要件: docs/model-weights.md
//
// インストーラの補助モードが照合・コピーする対象。テキストモデルの GGUF と画像の重み 2 つ(音声モデルは ENGINE と一緒に本体へ入る。論点 0072)。
// 値はそれぞれの定義(textModel.ts / imageWeights.ts)から作り、ここで持ち直さない(片方だけ直すと照合が合わなくなる)。

import { IMAGE_WEIGHT_FILES, IMAGE_WEIGHTS_DIR } from "./imageWeights.js";
import { TEXT_MODEL_FILE, TEXT_WEIGHTS_DIR } from "./textModel.js";

export interface BundledWeightFile {
  id: "text-model" | "base-model" | "lcm-lora";
  // インストーラと同じフォルダに置く別ファイルの名前(GitHub の Releases に添付する名前)
  sourceName: string;
  // {userData} の下の置き先
  relativePath: string;
  sha256: string;
  byteSize: number;
}

// LoRA は置き場で名前を変える(sd.cpp がプロンプトの名前で探す)。配布物の名前も置き先と同じにして迷わせない
const fileNameOf = (relativePath: string): string =>
  relativePath.slice(relativePath.lastIndexOf("/") + 1);

export const BUNDLED_WEIGHT_FILES: readonly BundledWeightFile[] = [
  {
    id: "text-model",
    sourceName: TEXT_MODEL_FILE.file,
    relativePath: `${TEXT_WEIGHTS_DIR}/${TEXT_MODEL_FILE.file}`,
    sha256: TEXT_MODEL_FILE.sha256,
    byteSize: TEXT_MODEL_FILE.byteSize,
  },
  ...IMAGE_WEIGHT_FILES.map((file) => ({
    id: file.id,
    sourceName: fileNameOf(file.relativePath),
    relativePath: `${IMAGE_WEIGHTS_DIR}/${file.relativePath}`,
    sha256: file.sha256,
    byteSize: file.byteSize,
  })),
];
