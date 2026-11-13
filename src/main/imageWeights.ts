// imageWeights: 画像の重みの取得の入口(状態・ライセンスへの同意・取得の開始と中断)。
// 要件: docs/model-weights.md S0042_02 / S0042_09 / S0042_11、docs/licenses.md S0047_05〜11(論点 0042 / 0047)
//
// ここが持つのは「いつ取得してよいか」の判定だけ。取得そのものは agent/imageWeightsFetch、設定の読み書きと
// ファイルは呼び出し側(IPC のグルー)が渡す。Electron に触れないので決定的にテストできる。
// 外部プロバイダーへの送信の同意(providers.consent)と監査ログには触れない(S0047_11)— その手段を受け取らない。

import type { FetchWeightsResult } from "../agent/imageWeightsFetch.js";
import {
  hasLicenseAgreement,
  IMAGE_WEIGHTS_LICENSE_VERSION,
  type ImageWeightsLicenseAgreement,
} from "../core/shared/imageWeights.js";
import type { ImageWeightsStatus, StartImageWeightsFetchResult } from "../core/shared/ipc.js";
import type { ImageProviderId } from "../core/shared/types.js";

export interface ImageWeightsServiceDeps {
  loadAgreement: () => unknown;
  saveAgreement: (agreement: ImageWeightsLicenseAgreement) => void;
  loadImageProvider: () => ImageProviderId;
  hasWeights: () => boolean;
  runFetch: (input: {
    onProgress: (doneBytes: number, totalBytes: number) => void;
    shouldCancel: () => boolean;
  }) => Promise<FetchWeightsResult>;
  now: () => string; // ISO 8601
  onProgress?: (status: ImageWeightsStatus) => void;
}

export interface ImageWeightsService {
  status(): ImageWeightsStatus;
  start(input: { hasAgreed: boolean }): Promise<StartImageWeightsFetchResult>;
  cancel(): void;
}

export function createImageWeightsService(deps: ImageWeightsServiceDeps): ImageWeightsService {
  let progress: { doneBytes: number; totalBytes: number } | null = null;
  let isCancelRequested = false;

  // S0042_02 利用者が始めるまで取得の通信をしない — 状態を読むだけでは何も取得しない
  const status = (): ImageWeightsStatus => {
    const hasWeights = deps.hasWeights();
    return {
      hasWeights,
      // S0042_09 画像の重みが無ければ取得の操作を出す / S0042_11 外部の画像プロバイダーなら出さない
      canFetch: deps.loadImageProvider() === "local-sdcpp" && !hasWeights && progress === null,
      needsLicenseAgreement: !hasLicenseAgreement(deps.loadAgreement()),
      progress,
    };
  };

  return {
    status,
    async start({ hasAgreed }) {
      if (progress !== null) return { ok: false, reason: "already-running" };
      if (!hasLicenseAgreement(deps.loadAgreement())) {
        // S0047_06 同意しなければ取得を始めない(通信も記録もしない)
        if (!hasAgreed) return { ok: false, reason: "license-agreement-required" };
        // S0047_08 同意したことと日時と、同意した対象の版を記録する
        deps.saveAgreement({ agreedAt: deps.now(), version: IMAGE_WEIGHTS_LICENSE_VERSION });
      }
      isCancelRequested = false;
      progress = { doneBytes: 0, totalBytes: 0 };
      try {
        return await deps.runFetch({
          onProgress: (doneBytes, totalBytes) => {
            progress = { doneBytes, totalBytes };
            deps.onProgress?.(status());
          },
          shouldCancel: () => isCancelRequested,
        });
      } finally {
        progress = null;
        deps.onProgress?.(status());
      }
    },
    cancel() {
      isCancelRequested = true;
    },
  };
}
