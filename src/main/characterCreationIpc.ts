// characterCreationIpc: キャラ作成(プール・wav 生成)の IPC 配線。
// spec: changes/0011-pool-generation-and-playback/spec.md
//
// **このモジュールだけが providers を import する。** index.ts(発動経路の配線)には
// 混ぜない — 発動経路は外部依存ゼロという不変条件をコードの構造としても保つため
// (index.ts 冒頭のコメントと eslint.config.js の mainCheerPathRestrictedPatterns)。
// 生成先はローカルのみ(Ollama / VOICEVOX)。外部プロバイダーは別 change。
//
// テスト対象外の I/O グルー。判定ロジックは characterCreation / characterStore 側にあり、
// そちらで注入して縛っている。

import { ipcMain, type BrowserWindow } from "electron";
import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import { createVoicevoxSynthesizer } from "../agent/providers/localVoicevox.js";
import { createGenerationRunner } from "./characterCreation.js";
import { loadPool, type CharacterFs } from "./characterStore.js";
import { IpcChannel } from "../shared/ipc.js";
import type { GenerationProgressPayload, StartGenerationResult } from "../shared/ipc.js";
import type { MessagePool } from "../engine/messagePool.js";
import type { AppStore } from "./store.js";

export interface CharacterCreationDeps {
  store: AppStore;
  fs: CharacterFs;
  userDataDir: string;
  // 生成完了時に発動経路へ反映する(再起動なしでプールを使わせる)
  onPoolReady: (characterId: string, pool: MessagePool) => void;
  // 進捗の送り先(メインウィンドウ)
  getWindow: () => BrowserWindow | null;
}

export function registerCharacterCreation(deps: CharacterCreationDeps): void {
  const runner = createGenerationRunner();

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

    // 再開:既存の完了状態があれば未完了バケットだけを続行する。
    // (pool.json には completion も保存している — characterStore.savePool)
    const resumeFrom = readResumeState(deps.fs, deps.userDataDir, character.id);

    const started = runner.start({
      characterId: character.id,
      character: { name: character.name, personality: character.personality },
      userDataDir: deps.userDataDir,
      fs: deps.fs,
      textGenerator: createOllamaTextGenerator({
        endpoint: system.ollamaEndpoint,
        model: system.ollamaModel,
      }),
      synthesizer: createVoicevoxSynthesizer({ endpoint: system.voicevoxEndpoint }),
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
