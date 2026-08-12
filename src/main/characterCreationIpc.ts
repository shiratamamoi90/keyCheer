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

import { ipcMain, safeStorage, type BrowserWindow } from "electron";
import Store from "electron-store";
import { createSecretStore } from "../agent/secrets.js";
import { createGenerationRunner } from "./characterCreation.js";
import { createTextGeneratorFor, createVoiceSynthesizerFor } from "./providerFactory.js";
import { checkGenerationGate } from "../core/providers/gate.js";
import { loadPool, type CharacterFs } from "./characterStore.js";
import { IpcChannel } from "../core/shared/ipc.js";
import type { GenerationProgressPayload, StartGenerationResult } from "../core/shared/ipc.js";
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
  // 生成完了時に発動経路へ反映する(再起動なしでプールを使わせる)
  onPoolReady: (characterId: string, pool: MessagePool) => void;
  // 進捗の送り先(メインウィンドウ)
  getWindow: () => BrowserWindow | null;
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

export function registerCharacterCreation(deps: CharacterCreationDeps): void {
  const runner = createGenerationRunner();
  const secrets = deps.secrets ?? createDefaultSecretAccess();

  const emit = (payload: GenerationProgressPayload): void => {
    const win = deps.getWindow();
    if (win !== null && !win.isDestroyed()) {
      win.webContents.send(IpcChannel.GenerationProgress, payload);
    }
  };

  ipcMain.handle(IpcChannel.StartGeneration, async (): Promise<StartGenerationResult> => {
    const character = deps.store.loadCharacter();
    // シナリオ: 生成は保存済みキャラに対してのみ(characterId が無いと保存先が決まらない)
    if (character === undefined || character.id === undefined) {
      return { ok: false, reason: "no-character" };
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

    const factoryDeps = { system, apiKeyFor: secrets.apiKeyFor, voiceIdFor: secrets.voiceIdFor };
    const text = createTextGeneratorFor(selection.text, factoryDeps);
    if (!text.ok) return { ok: false, reason: text.reason, provider: selection.text };
    const voice = createVoiceSynthesizerFor(selection.voice, factoryDeps);
    if (!voice.ok) return { ok: false, reason: voice.reason, provider: selection.voice };

    // 再開:既存の完了状態があれば未完了バケットだけを続行する。
    // (pool.json には completion も保存している — characterStore.savePool)
    const resumeFrom = readResumeState(deps.fs, deps.userDataDir, character.id);

    const started = runner.start({
      characterId: character.id,
      character: { name: character.name, personality: character.personality },
      userDataDir: deps.userDataDir,
      fs: deps.fs,
      textGenerator: text.generator,
      synthesizer: voice.synthesizer,
      speakerId: character.voicevoxSpeakerId,
      ...(resumeFrom !== undefined ? { resumeFrom } : {}),
      onProgress: (p) => emit({ type: "progress", phase: p.phase, done: p.done, total: p.total }),
    });

    if (runner.isRunning()) {
      // 実行中に完了を待たず応答を返す。進捗と結果は GenerationProgress で流す。
      void started.then((result) => {
        if (result.ok) {
          // シナリオ: 生成直後は再起動なしで応援に反映される
          deps.onPoolReady(character.id, result.pool);
          emit({ type: "done", synthesized: result.synthesized, missing: result.missing });
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
  });

  ipcMain.handle(IpcChannel.CancelGeneration, () => {
    runner.cancel();
  });
}

// pool.json に残した completion から再開状態を組み立てる。
// 壊れている・存在しない場合は undefined(= 最初から生成する)。
function readResumeState(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
):
  | { pool: MessagePool; completion: Record<string, "complete" | "pending" | "failed"> }
  | undefined {
  const pool = loadPool(fs, userDataDir, characterId);
  if (pool === null) return undefined;

  const raw = fs.readFile(`${userDataDir}/characters/${characterId}/pool.json`);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as { completion?: unknown };
    if (typeof parsed.completion !== "object" || parsed.completion === null) return undefined;
    return {
      pool,
      completion: parsed.completion as Record<string, "complete" | "pending" | "failed">,
    };
  } catch {
    return undefined;
  }
}
