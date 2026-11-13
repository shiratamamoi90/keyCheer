// imageWeightsView: 設定画面の、画像の重みの取得とライセンスの表示の文言(純粋関数)。
// 要件: docs/model-weights.md S0042_02 / S0042_03 / S0042_09、docs/licenses.md S0047_01 / S0047_05(論点 0042 / 0047)
//
// DOM 操作と IPC は mainEntry 側の I/O グルー。ここは「何を示すか」だけを持つ。
// ライセンスの全文は同梱したファイル(assets/licenses/。原文のまま)を main が読んで渡す。通信しない(S0047_10)。
// core 実装 / providers / agent は import しない。

import { buildImageWeightSource, IMAGE_WEIGHT_FILES } from "../core/shared/imageWeights.js";
import type {
  ImageWeightsLicenseTexts,
  ImageWeightsStatus,
  StartImageWeightsFetchResult,
} from "../core/shared/ipc.js";

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

export function formatByteSize(byteSize: number): string {
  return byteSize >= BYTES_PER_GB
    ? `${(byteSize / BYTES_PER_GB).toFixed(1)} GB`
    : `${Math.round(byteSize / BYTES_PER_MB)} MB`;
}

// S0042_02 取得の前に、サイズ・取得元を示す
export function buildImageWeightLines(): string[] {
  return IMAGE_WEIGHT_FILES.map(
    (file) =>
      `${file.displayName}(${formatByteSize(file.byteSize)})取得元: ${buildImageWeightSource(file)}`,
  );
}

// S0042_03 取得中は進捗を示す
export function imageWeightsStatusLabel(status: ImageWeightsStatus): string {
  if (status.progress !== null) {
    const { doneBytes, totalBytes } = status.progress;
    return `取得中… ${formatByteSize(doneBytes)} / ${formatByteSize(totalBytes)}`;
  }
  return status.hasWeights ? "取得済み" : "未取得";
}

type FailureReason = Extract<StartImageWeightsFetchResult, { ok: false }>["reason"];

const FAILURE_TEXT: Record<FailureReason, string> = {
  cancelled: "取得を中断しました。もう一度始めると続きから取得します",
  network: "取得元と通信できませんでした。もう一度始めると続きから取得します",
  "hash-mismatch": "取得したファイルが壊れていました。取り直してください",
  "insufficient-space": "空き容量が足りないので、取得を始めませんでした",
  "license-agreement-required": "取得するには、ライセンスと利用の制限への同意が要ります",
  "already-running": "すでに取得中です",
};

export function imageWeightsFailureText(reason: FailureReason): string {
  return FAILURE_TEXT[reason];
}

export interface ImageWeightsLicenseSection {
  name: string;
  source: string;
  licenseName: string;
  text: string; // ライセンスの全文
}

// S0047_01 画像の重みのライセンス — 重みを取得していなくても同じ内容を出す(引数に状態を取らない)
export function buildImageWeightsLicenseSections(
  texts: ImageWeightsLicenseTexts,
): ImageWeightsLicenseSection[] {
  return IMAGE_WEIGHT_FILES.map((file) => ({
    name: file.displayName,
    source: buildImageWeightSource(file),
    licenseName: file.licenseName,
    text: texts[file.id],
  }));
}

// 利用の制限(ライセンスの別紙 A)。2 つのライセンスで項目は同じなので、ベースモデルの本文から取り出す。
// 取り出せなかったときは全文を返す(制限を示さないまま同意を求めないため)
const USE_RESTRICTION_HEADING = "Attachment A";

export function buildUseRestrictionText(texts: ImageWeightsLicenseTexts): string {
  const text = texts["base-model"];
  const start = text.lastIndexOf(USE_RESTRICTION_HEADING);
  return start < 0 ? text : text.slice(start).trim();
}

export const IMAGE_WEIGHTS_AGREE_LABEL =
  "上のライセンスと利用の制限を読み、同意します(制限に反する使い方をしません)";
