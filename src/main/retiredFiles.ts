// retiredFiles: 前の版が残したファイルを起動時に消す(論点 0054。docs/data-model.md「前の版が残したもの」)。
//
// 外部プロバイダーを削除したので、API キーの暗号化済みの保存先(electron-store の name "secrets")と
// 監査ログはもう読み書きしない。秘密を OS のユーザー領域に残さないため、起動のたびに消す。
// 消すのはこの 2 つだけ(S0054_04)。ディレクトリごとの掃除にしないのは、置き場に利用者のキャラクターと重みがあるため。

import { join } from "node:path";
import { logWarn } from "./log.js";

const RETIRED_FILE_NAMES = ["secrets.json", "audit.log.json"] as const;

export interface RetiredFilesDeps {
  userDataDir: string;
  // 無いファイルを消しても throw しない実装を渡す(rmSync の force)。消せないときは throw してよい
  removeFile: (path: string) => void;
}

export function removeRetiredFiles(deps: RetiredFilesDeps): void {
  for (const name of RETIRED_FILE_NAMES) {
    const path = join(deps.userDataDir, name);
    try {
      deps.removeFile(path);
    } catch (error) {
      // S0054_03 消せなくても起動は続ける。次の起動で消し直す
      logWarn(`could not remove ${path}:`, error);
    }
  }
}
