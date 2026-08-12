// nodeCharacterFs: characterStore が要求する CharacterFs の Node 実装。
// spec: 論点 0020
// テスト対象外の I/O グルー(判定ロジックを持たない)。テストは characterStore 側で
// インメモリの偽物を注入して縛る。providers には触れないため発動経路から使ってよい。

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import type { CharacterFs } from "./characterStore.js";

export function createNodeCharacterFs(): CharacterFs {
  return {
    exists: (path) => existsSync(path),

    // 未存在・読み取り失敗は undefined。呼び出し側(loadPool)が baseline へ落とす。
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },

    writeFile: (path, data) => {
      writeFileSync(path, data);
    },

    mkdirRecursive: (path) => {
      mkdirSync(path, { recursive: true });
    },

    removeDirRecursive: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
  };
}
