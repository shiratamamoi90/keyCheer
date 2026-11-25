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
const MESSAGE_FLAG = "--message-file=";
// NSIS の Unicode 版が FileReadUTF16LE で 1 行ずつ読めるよう、文面は UTF-16LE で書く(BOM は付けない —
// 付けると 1 行目の先頭に混ざるおそれがある)
// NSIS のメッセージボックスの改行
const NEWLINE = "\r\n";
const BYTES_PER_GB = 1_000_000_000;

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
  // インストーラの画面に出す文面の書き出し先(失敗のときだけ書く)
  messageFile: string | null;
}

export function resolveWeightInstallArgs(argv: readonly string[]): WeightInstallArgs | null {
  const source = argv.find((arg) => arg.startsWith(INSTALL_FLAG));
  if (source === undefined) return null;
  const valueOf = (flag: string): string | null => {
    const arg = argv.find((candidate) => candidate.startsWith(flag));
    return arg === undefined ? null : arg.slice(flag.length);
  };
  return {
    sourceDir: source.slice(INSTALL_FLAG.length),
    resultFile: valueOf(RESULT_FLAG),
    messageFile: valueOf(MESSAGE_FLAG),
  };
}

export type WeightInstallReport =
  | WeightInstallResult
  | {
      ok: false;
      reason: "import-failed";
      detail: Extract<TextModelImportResult, { ok: false }>["reason"];
    };

// S0055_02 / S0055_03 足りない・一致しないファイルの名前を示す / S0055_04 空き容量が足りない旨 / S0073_04 取り込めなかった旨
export function buildWeightInstallMessage(
  report: Exclude<WeightInstallReport, { ok: true }>,
): string {
  const gb = (bytes: number): string => (bytes / BYTES_PER_GB).toFixed(1);
  switch (report.reason) {
    case "missing":
      return [
        "インストーラと同じフォルダに、次のファイルがありません。すべて同じフォルダに置いてから、もう一度インストールしてください。",
        ...report.files,
      ].join(NEWLINE);
    case "mismatch":
      return [
        "次のファイルが壊れているか、別の版です。配布元から落とし直してから、もう一度インストールしてください。",
        ...report.files,
      ].join(NEWLINE);
    case "no-space":
      return `空き容量が足りません(必要 ${gb(report.requiredBytes)} GB、空き ${gb(report.freeBytes)} GB)。空きを作ってから、もう一度インストールしてください。`;
    case "import-failed":
      return "テキストモデルを Ollama に取り込めませんでした。もう一度インストールしてください。";
  }
}

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
  if (deps.args.messageFile !== null && !report.ok) {
    writeFileSync(deps.args.messageFile, buildWeightInstallMessage(report), "utf16le");
  }
  return { exitCode, report };
}
