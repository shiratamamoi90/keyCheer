// characterCreationIpc: キャラ作成(プール・wav 生成)の IPC 配線。
// spec: 論点 0020
//
// **このモジュールだけが providers を import する。** index.ts(発動経路の配線)には
// 混ぜない — 発動経路は外部依存ゼロという不変条件をコードの構造としても保つため
// (index.ts 冒頭のコメントと eslint.config.js の mainCheerPathRestrictedPatterns)。
// 生成先は providers 設定に従う(既定はローカル一式)。外部を選んだ場合は
// checkGenerationGate で同意・API キーを確かめてからでないと組み立てに進まない。
//
// テスト対象外の I/O グルー。判定ロジックは characterCreation / characterStore 側にあり、
// そちらで注入して縛っている。

import { spawn as spawnChild } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ipcMain, nativeImage, safeStorage, type BrowserWindow } from "electron";
import Store from "electron-store";
import { createSecretStore } from "../agent/secrets.js";
import {
  buildImagesSummary,
  createGenerationRunner,
  saveGenerationResult,
} from "./characterCreation.js";
import {
  createImageGeneratorFor,
  createTextGeneratorFor,
  createVoiceSynthesizerFor,
} from "./providerFactory.js";
import { checkGenerationGate } from "../core/providers/gate.js";
import { checkGenerationPreconditions } from "../core/providers/consent.js";
import { applyRedBlueSwap, computeImageSize, type RgbaImage } from "../core/characterImage.js";
import { createChildTracker, resolveSdcppPaths } from "./bundledSdcpp.js";
import { registerImageWeights } from "./imageWeightsIpc.js";
import type { ImageGenerationInput } from "./characterCreation.js";
import { loadPool, loadGeneratedProfile, type CharacterFs } from "./characterStore.js";
import { resolveGenerationStart } from "./generationStart.js";
import { deleteCharacter } from "./characterDeletion.js";
import { activateCharacter, loadCharacterList } from "./characterSelection.js";
import { IpcChannel } from "../core/shared/ipc.js";
import type {
  ActivateCharacterResult,
  CharacterListItem,
  DeleteCharacterResult,
  GenerationProgressPayload,
  StartGenerationResult,
} from "../core/shared/ipc.js";
import type { MessagePool } from "../core/messagePool.js";
import type { ProviderId } from "../core/shared/types.js";
import type { AppStore } from "./store.js";
import type { ProviderStore } from "./providerStore.js";

export interface CharacterCreationDeps {
  store: AppStore;
  providers: ProviderStore;
  // API キー・voice ID の解決。既定は safeStorage(下の createDefaultSecretAccess)。
  // 注入可能にしてあるのは、index.ts に secrets を import させないため
  // (index.ts は発動経路の配線に徹する。eslint.config.js)。
  secrets?: SecretAccess;
  fs: CharacterFs;
  userDataDir: string;
  // 使用中になったキャラクターのプールを発動経路へ渡す(再起動なしで使わせる)
  onActiveCharacterChanged: (characterId: string, pool: MessagePool) => void;
  // 使用中のキャラクターを削除したことを発動経路へ伝える(baseline 定型文に戻す。S0032_07)
  onActiveCharacterRemoved: () => void;
  // 進捗の送り先(メインウィンドウ)
  getWindow: () => BrowserWindow | null;
  // 同梱した sd.cpp の置き場(論点 0040)。resourcesDir の下の sdcpp/ に実行ファイルがある。
  // 渡さなければ local-sdcpp は組み立てない(画像なしで生成を完了する)
  sdcpp?: { resourcesDir: string; tempDir: string };
}

export interface CharacterCreationHandle {
  // S0040_05 アプリ終了時に、実行中の sd.cpp を止める
  stopSdcpp(): void;
}

// 画像の生成の大きさとシード(docs/data-model.md `system.imageGen` の既定値 512x768)。
// `system.imageGen` の読み込みは未実装なので既定値をここに置く。保存する大きさ(256x384)は別で、
// core/characterImage の computeImageSize が持つ(S0036_15)。
// シードは固定する(再現性の不変条件)。キャラごとに変える必要が出たら設定に出す。
const IMAGE_GENERATION_WIDTH = 512;
const IMAGE_GENERATION_HEIGHT = 768;
const IMAGE_SEED = 42;

// S0036_15 縮小して PNG で保存する — 縦横比を保って 256x384 に収める。
// 読めない画像は throw し、その画像だけ失敗になる(characterImage のオーケストレーションが拾う)。
function encodeCharacterImage(bytes: Uint8Array): Uint8Array {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) throw new Error("image could not be decoded");
  const { width, height } = image.getSize();
  return new Uint8Array(image.resize(computeImageSize(width, height)).toPNG());
}

// API キーと voice ID の解決だけを表す最小の口。値はここで保持しない。
export interface SecretAccess {
  apiKeyFor: (id: ProviderId) => string | null;
  voiceIdFor: (id: ProviderId) => string | null;
}

// 既定の解決:キーは safeStorage(平文 JSON に出さない — 不変条件)。
// voice ID は [要確認] のため常に null。決まるまで ElevenLabs は組み立てに進まない。
function createDefaultSecretAccess(): SecretAccess {
  const blobs = new Store<Record<string, string>>({ name: "secrets" });
  const secretStore = createSecretStore({
    safeStorage,
    backend: {
      get: (id) => blobs.get(id),
      set: (id, value) => blobs.set(id, value),
      has: (id) => blobs.has(id),
      delete: (id) => blobs.delete(id),
    },
  });
  return {
    apiKeyFor: (id) => secretStore.getApiKey(id),
    voiceIdFor: () => null,
  };
}

// --- local-sdcpp の作り方に要る画素の読み書き(論点 0046)。Electron の nativeImage の画素は B・G・R・A の順 ---

// S0046_06 白で塗りつぶした下地
function makeWhiteCanvas(width: number, height: number): Uint8Array {
  const WHITE = 255;
  const bitmap = Buffer.alloc(width * height * 4, WHITE);
  return new Uint8Array(nativeImage.createFromBitmap(bitmap, { width, height }).toPNG());
}

// S0046_09 縮小してから画素の並びにする(縮小は S0036_15 と同じ大きさ)
function decodeScaledImage(bytes: Uint8Array): RgbaImage {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) throw new Error("image could not be decoded");
  const size = image.getSize();
  const scaled = image.resize(computeImageSize(size.width, size.height));
  const { width, height } = scaled.getSize();
  return applyRedBlueSwap({ width, height, pixels: new Uint8Array(scaled.toBitmap()) });
}

function encodeImagePng(image: RgbaImage): Uint8Array {
  const bitmap = Buffer.from(applyRedBlueSwap(image).pixels);
  return new Uint8Array(
    nativeImage.createFromBitmap(bitmap, { width: image.width, height: image.height }).toPNG(),
  );
}

export function registerCharacterCreation(deps: CharacterCreationDeps): CharacterCreationHandle {
  // 同梱した sd.cpp(論点 0040)。シェルを経由せず、引数配列で起動する(不変条件)。窓は出さない
  const sdcppChildren = createChildTracker((command, args) => {
    const child = spawnChild(command, args, { stdio: "ignore", windowsHide: true });
    return {
      on: (event, listener) => {
        child.on(event, listener);
      },
      // タイムアウトでも終了時でも、途中の絵は要らないので待たずに止める
      kill: () => {
        child.kill("SIGKILL");
      },
    };
  });
  const sdcppRuntime =
    deps.sdcpp === undefined
      ? undefined
      : {
          paths: resolveSdcppPaths({
            resourcesDir: deps.sdcpp.resourcesDir,
            userDataDir: deps.userDataDir,
            platform: process.platform,
          }),
          exists: existsSync,
          spawn: sdcppChildren.spawn,
          readOutput: (path: string) => new Uint8Array(readFileSync(path)),
          writeInput: (path: string, bytes: Uint8Array) => {
            mkdirSync(deps.sdcpp!.tempDir, { recursive: true });
            writeFileSync(path, bytes);
          },
          removeFile: (path: string) => rmSync(path, { force: true }),
          tempDir: deps.sdcpp.tempDir,
        };

  const runner = createGenerationRunner();
  // どのキャラクターを生成中か。削除(S0032_08)・切り替え(S0032_13)・一覧(S0033_11)が見る。
  // runner は id を知らない(生成の中身だけを持つ)ので、IPC の側で持つ。
  let generatingCharacterId: string | null = null;
  const generation = {
    isGenerating: (characterId: string) =>
      runner.isRunning() && generatingCharacterId === characterId,
  };
  const loadPoolOf = (characterId: string): MessagePool | null =>
    loadPool(deps.fs, deps.userDataDir, characterId);
  const secrets = deps.secrets ?? createDefaultSecretAccess();

  const emit = (payload: GenerationProgressPayload): void => {
    const win = deps.getWindow();
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send(IpcChannel.GenerationProgress, payload);
    }
  };

  // S0032_18 生成は選んだキャラクターに対して行う
  ipcMain.handle(
    IpcChannel.StartGeneration,
    async (_event, characterId: unknown, options: unknown): Promise<StartGenerationResult> => {
      const character = deps.store.loadCharacters().find((c) => c.id === characterId);
      // シナリオ: 生成は保存済みキャラに対してのみ(characterId が無いと保存先が決まらない)
      // renderer から届いた id は一覧にあるものだけを受け付ける(S0033_09 を main 側でも守る)
      if (character === undefined) {
        return { ok: false, reason: "no-character" };
      }

      // 再開か作り直しか(論点 0038)。作り直しで確認がまだなら、何も組み立てず・何も消さずに返す。
      // 同意・キーの確認より先に置く — 確認で取りやめる人に同意ダイアログを出さないため。
      // 確認済みの印は true のときだけ受け付ける(renderer からの値は信頼境界の外)。
      const isRebuildConfirmed =
        typeof options === "object" &&
        options !== null &&
        (options as { isRebuildConfirmed?: unknown }).isRebuildConfirmed === true;
      const start = resolveGenerationStart({
        fs: deps.fs,
        userDataDir: deps.userDataDir,
        characterId: character.id,
        profile: {
          name: character.name,
          personality: character.personality,
          voicevoxSpeakerId: character.voicevoxSpeakerId,
        },
        isRebuildConfirmed,
      });
      if (start.kind === "confirmation-required") {
        return { ok: false, reason: "rebuild-confirmation-required" };
      }

      const system = deps.store.loadSystem();
      const selection = deps.providers.loadProviders();

      // シナリオ: 外部選択時は同意ダイアログを経る / APIキー未設定で外部を選んだ場合 [異常系]
      // ここを通らない限り外部への送信は起こらない(組み立てにも進まない)。
      const gate = checkGenerationGate({
        selection,
        consent: deps.providers.loadConsent(),
        hasApiKey: (id) => secrets.apiKeyFor(id) !== null,
      });
      if (!gate.ok) return { ok: false, reason: gate.reason, provider: gate.provider };

      const factoryDeps = {
        system,
        apiKeyFor: secrets.apiKeyFor,
        voiceIdFor: secrets.voiceIdFor,
        ...(sdcppRuntime !== undefined ? { sdcpp: sdcppRuntime } : {}),
      };
      const text = createTextGeneratorFor(selection.text, factoryDeps);
      if (!text.ok) return { ok: false, reason: text.reason, provider: selection.text };
      const voice = createVoiceSynthesizerFor(selection.voice, factoryDeps);
      if (!voice.ok) return { ok: false, reason: voice.reason, provider: selection.voice };

      // 画像(論点 0036)。画像プロバイダーが使えないときは文言・音声を止めず、画像なしで生成する(S0036_10)。
      // 外部の画像プロバイダーは同意とキーが揃わない限り組み立てない — ここを通らなければ送信は起こらない
      // (checkGenerationGate は text / voice だけを見る)。
      const imagePrecondition = checkGenerationPreconditions({
        provider: selection.image,
        hasApiKey: secrets.apiKeyFor(selection.image) !== null,
        consent: deps.providers.loadConsent(),
      });
      const imageBuilt = imagePrecondition.ok
        ? createImageGeneratorFor(selection.image, factoryDeps)
        : null;
      const image: ImageGenerationInput | undefined =
        imageBuilt !== null && imageBuilt.ok
          ? {
              generator: imageBuilt.generator,
              tagGenerator: text.generator,
              seed: IMAGE_SEED,
              width: IMAGE_GENERATION_WIDTH,
              height: IMAGE_GENERATION_HEIGHT,
              encode: encodeCharacterImage,
              // local-sdcpp のときだけ使われる(外部の画像プロバイダーには当てない。S0046_16)
              local: {
                makeCanvas: makeWhiteCanvas,
                decodeScaled: decodeScaledImage,
                encodePng: encodeImagePng,
              },
            }
          : undefined;

      // 画像の工程に進めない理由(完了の通知に載せて画面に出す。S0036_10)
      const imageUnavailableReason = !imagePrecondition.ok
        ? imagePrecondition.reason
        : imageBuilt !== null && !imageBuilt.ok
          ? imageBuilt.reason
          : null;

      // 再開なら未完了バケットだけを続行する。作り直しでは渡さない(古い画像も消してから作る。S0036_13)
      const resumeFrom = start.resumeFrom;

      if (!runner.isRunning()) generatingCharacterId = character.id;
      const started = runner.start({
        characterId: character.id,
        character: { name: character.name, personality: character.personality },
        userDataDir: deps.userDataDir,
        fs: deps.fs,
        textGenerator: text.generator,
        synthesizer: voice.synthesizer,
        speakerId: character.voicevoxSpeakerId,
        ...(resumeFrom !== undefined ? { resumeFrom } : {}),
        ...(image !== undefined ? { image } : {}),
        onProgress: (p) => emit({ type: "progress", phase: p.phase, done: p.done, total: p.total }),
      });

      if (runner.isRunning()) {
        // 実行中に完了を待たず応答を返す。進捗と結果は GenerationProgress で流す。
        void started.then((result) => {
          generatingCharacterId = null;
          // 生成元の記録と、完了時の使用中の更新(論点 0022 / 0032)
          saveGenerationResult(
            {
              store: deps.store,
              loadPool: loadPoolOf,
              onActiveCharacterChanged: deps.onActiveCharacterChanged,
            },
            character.id,
            result,
          );
          if (result.ok) {
            emit({
              type: "done",
              synthesized: result.synthesized,
              missing: result.missing,
              images: buildImagesSummary(result.images, imageUnavailableReason),
            });
          } else {
            emit({ type: "failed", reason: result.reason });
          }
        });
        return { ok: true };
      }

      // start が即座に返った = already-running
      const result = await started;
      if (!result.ok && result.reason === "already-running") {
        return { ok: false, reason: "already-running" };
      }
      return { ok: true };
    },
  );

  ipcMain.handle(IpcChannel.CancelGeneration, () => {
    runner.cancel();
  });

  ipcMain.handle(IpcChannel.ListCharacters, (): CharacterListItem[] =>
    loadCharacterList({
      store: deps.store,
      loadPool: loadPoolOf,
      generation,
      loadGeneratedProfile: (id) => loadGeneratedProfile(deps.fs, deps.userDataDir, id),
    }),
  );

  ipcMain.handle(
    IpcChannel.DeleteCharacter,
    (_event, characterId: unknown): DeleteCharacterResult => {
      if (typeof characterId !== "string") return { ok: false, reason: "not-found" };
      return deleteCharacter(
        {
          store: deps.store,
          fs: deps.fs,
          userDataDir: deps.userDataDir,
          isGenerating: generation.isGenerating,
          onActiveCharacterRemoved: deps.onActiveCharacterRemoved,
        },
        characterId,
      );
    },
  );

  ipcMain.handle(
    IpcChannel.ActivateCharacter,
    (_event, characterId: unknown): ActivateCharacterResult =>
      activateCharacter(
        {
          store: deps.store,
          loadPool: loadPoolOf,
          generation,
          onActiveCharacterChanged: deps.onActiveCharacterChanged,
        },
        characterId,
      ),
  );

  // 画像の重みの取得とライセンスへの同意(論点 0042 / 0047)。生成側の関心なので、ここから登録する
  registerImageWeights({
    store: deps.store,
    providers: deps.providers,
    userDataDir: deps.userDataDir,
    getWindow: deps.getWindow,
  });

  return { stopSdcpp: () => sdcppChildren.stopAll() };
}
