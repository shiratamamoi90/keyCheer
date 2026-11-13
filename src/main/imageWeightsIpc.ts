// imageWeightsIpc: 画像の重みの取得の IPC 配線と、ファイルの操作(論点 0042 / 0047)。
// 判定は main/imageWeights、取得は agent/imageWeightsFetch にあり、そちらで注入して縛っている。
// ここはテスト対象外の I/O グルー(Electron の ipcMain と Node の fs)。
// 発動経路(index.ts / keyHook / cheerRuntime)からは import しない — characterCreationIpc が登録する。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ipcMain, type BrowserWindow } from "electron";
import { fetchImageWeights } from "../agent/imageWeightsFetch.js";
import {
  buildImageWeightUrl,
  IMAGE_WEIGHT_FILES,
  IMAGE_WEIGHTS_DIR,
} from "../core/shared/imageWeights.js";
import { IpcChannel } from "../core/shared/ipc.js";
import type {
  ImageWeightsLicenseTexts,
  ImageWeightsStatus,
  StartImageWeightsFetchResult,
} from "../core/shared/ipc.js";
import { createImageWeightsService } from "./imageWeights.js";
import { createNodeWeightPartStore } from "./weightPartStore.js";
import type { ProviderStore } from "./providerStore.js";
import type { AppStore } from "./store.js";

// 同梱したライセンスの本文(原文のまま。assets/licenses/)。dist/main から見た置き場
const LICENSES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../assets/licenses");
const LICENSE_FILES: Record<keyof ImageWeightsLicenseTexts, string> = {
  "base-model": "creativeml-open-rail-m.txt",
  "lcm-lora": "creativeml-open-rail-pp-m.txt",
};

export interface ImageWeightsIpcDeps {
  store: AppStore;
  providers: ProviderStore;
  userDataDir: string;
  getWindow: () => BrowserWindow | null;
}

export function registerImageWeights(deps: ImageWeightsIpcDeps): void {
  const weightsDir = `${deps.userDataDir}/${IMAGE_WEIGHTS_DIR}`;
  const downloads = IMAGE_WEIGHT_FILES.map((file) => ({
    url: buildImageWeightUrl(file),
    destPath: `${weightsDir}/${file.relativePath}`,
    sha256: file.sha256,
    byteSize: file.byteSize,
  }));
  const partStore = createNodeWeightPartStore(weightsDir);

  const service = createImageWeightsService({
    loadAgreement: () => deps.store.loadImageWeightsLicenseAgreement(),
    saveAgreement: (agreement) => deps.store.saveImageWeightsLicenseAgreement(agreement),
    loadImageProvider: () => deps.providers.loadProviders().image,
    hasWeights: () => downloads.every((file) => existsSync(file.destPath)),
    runFetch: ({ onProgress, shouldCancel }) =>
      fetchImageWeights({ files: downloads, store: partStore, onProgress, shouldCancel }),
    now: () => new Date().toISOString(),
    onProgress: (status) => {
      const win = deps.getWindow();
      if (win !== null && !win.isDestroyed()) {
        win.webContents.send(IpcChannel.ImageWeightsProgress, status);
      }
    },
  });

  ipcMain.handle(IpcChannel.GetImageWeightsStatus, (): ImageWeightsStatus => service.status());
  // 信頼境界:renderer から来た値は真偽値としてだけ受け取る(true 以外は同意していない扱い)
  ipcMain.handle(
    IpcChannel.StartImageWeightsFetch,
    async (_event, hasAgreed: unknown): Promise<StartImageWeightsFetchResult> => {
      try {
        return await service.start({ hasAgreed: hasAgreed === true });
      } catch {
        // ファイルの操作の失敗(書き込めない など)。取得した分は残り、次に続きから取れる
        return { ok: false, reason: "network" };
      }
    },
  );
  ipcMain.handle(IpcChannel.CancelImageWeightsFetch, () => service.cancel());
  // S0047_01 / S0047_10 ライセンスの全文は同梱したファイルから読む(通信しない)
  ipcMain.handle(
    IpcChannel.GetImageWeightsLicenseTexts,
    (): ImageWeightsLicenseTexts => ({
      "base-model": readFileSync(join(LICENSES_DIR, LICENSE_FILES["base-model"]), "utf8"),
      "lcm-lora": readFileSync(join(LICENSES_DIR, LICENSE_FILES["lcm-lora"]), "utf8"),
    }),
  );
}
