// weightInstallMode: インストーラが入れたアプリを「重みを置くモード」で起動したときの入口(論点 0072)。
// 要件: docs/model-weights.md S0055_01〜04・S0055_06・S0073_01〜05
//
// 窓もトレイもキーフックも出さず、重みの照合とコピー(weightInstall)→ テキストモデルの取り込み(textModelImport)をして終わる。
// 結果はインストーラ(NSIS)に終了コードと結果のファイルで返す。Windows の GUI アプリの標準出力はインストーラから読みにくいので、
// 画面に出す名前(足りないファイル・一致しないファイル)はファイルに書く。

import { writeFileSync } from "node:fs";
import type { TextModelImportResult } from "./textModelImport.js";
import type { WeightInstallResult } from "./weightInstall.js";

const INSTALL_FLAG = "--install-weights=";
const RESULT_FLAG = "--result-file=";

// インストーラが分岐に使う終了コード(installer.nsh と同じ値)
export const WEIGHT_INSTALL_EXIT_CODE = {
  ok: 0,
  missing: 2,
  mismatch: 3,
  "no-space": 4,
  "import-failed": 5,
} as const;

export interface WeightInstallArgs {
  sourceDir: string;
  resultFile: string | null;
}

export function resolveWeightInstallArgs(argv: readonly string[]): WeightInstallArgs | null {
  const source = argv.find((arg) => arg.startsWith(INSTALL_FLAG));
  if (source === undefined) return null;
  const result = argv.find((arg) => arg.startsWith(RESULT_FLAG));
  return {
    sourceDir: source.slice(INSTALL_FLAG.length),
    resultFile: result === undefined ? null : result.slice(RESULT_FLAG.length),
  };
}

export type WeightInstallReport =
  | WeightInstallResult
  | {
      ok: false;
      reason: "import-failed";
      detail: Extract<TextModelImportResult, { ok: false }>["reason"];
    };

export async function runWeightInstallMode(deps: {
  args: WeightInstallArgs;
  install: (sourceDir: string) => Promise<WeightInstallResult>;
  importTextModel: () => Promise<TextModelImportResult>;
}): Promise<{ exitCode: number; report: WeightInstallReport }> {
  const installed = await deps.install(deps.args.sourceDir);
  let report: WeightInstallReport = installed;
  if (installed.ok) {
    // S0073_01 重みを置いたあとに取り込む / S0073_04 取り込めなければインストールを完了しない
    const imported = await deps.importTextModel();
    if (!imported.ok) report = { ok: false, reason: "import-failed", detail: imported.reason };
  }
  const exitCode = report.ok
    ? WEIGHT_INSTALL_EXIT_CODE.ok
    : WEIGHT_INSTALL_EXIT_CODE[report.reason];
  if (deps.args.resultFile !== null) {
    writeFileSync(deps.args.resultFile, `${JSON.stringify(report)}\n`);
  }
  return { exitCode, report };
}
