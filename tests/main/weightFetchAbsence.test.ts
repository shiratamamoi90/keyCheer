// アプリは重みの取得の通信をしない(論点 0055。docs/model-weights.md)。
// 重みはインストーラが配布物の別ファイルから置く。アプリの中に取得の手段(取得元の URL・取得の処理)が
// 残っていれば、どこかの操作から通信が起こりうる。ソースの中身で、手段が無いことを縛る。

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIRS = ["src/main", "src/agent", "src/core", "src/preload", "src/renderer"];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("アプリは重みの取得の通信をしない [否定]", () => {
  it("S0055_07 the app sources hold no weight download source and no fetch of weights", () => {
    const files = SRC_DIRS.flatMap(listSourceFiles);
    const violations = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      // 取得の URL(Hugging Face の resolve)と、取得の処理・取得の IPC の名前。
      // 配布元を文字として示す(ライセンスの表示。論点 0047)のは通信ではないので対象にしない
      return /\/resolve\/|buildImageWeightUrl|imageWeightsFetch|ImageWeightsFetch|fetchImageWeights/.test(
        text,
      );
    });
    expect(violations).toEqual([]);
  });
});
