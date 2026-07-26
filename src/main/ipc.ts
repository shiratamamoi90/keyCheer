// ipc: main 側の IPC ハンドラ登録。renderer からの設定取得/更新・統計取得を捌く。
// 設定更新は engine で検証してから永続化し、発動中の cheerRuntime へ即時反映する。
// チャンネル名の正本は shared/ipc.ts(main/renderer が同じ定数を参照)。

import { ipcMain } from "electron";
import { validateTriggerConfig } from "../engine/index.js";
import { IpcChannel } from "../shared/ipc.js";
import type { AppStore } from "./store.js";
import type { TriggerConfig } from "../shared/types.js";
import type { GetSpeakersResult, SaveCharacterResult } from "../shared/ipc.js";
import { fetchSpeakers } from "./speakerCatalog.js";
// 信頼境界の検証は electron 非依存の別モジュールに置く(テストで縛るため)。
import { validateCharacterProfile } from "./characterInput.js";

export interface IpcDeps {
  store: AppStore;
  // 更新された設定を発動経路へ即時反映する(store 永続化とは別に RuntimeState 側へ)
  onConfigUpdated: (config: TriggerConfig) => void;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle(IpcChannel.GetTriggerConfig, () => deps.store.loadTriggerConfig().config);

  ipcMain.handle(IpcChannel.UpdateTriggerConfig, (_event, raw: unknown) => {
    // 信頼境界:renderer からの入力は必ず engine で検証(security-rules.md「入力と信頼境界」)。
    const validated = validateTriggerConfig(raw);
    if (!validated.ok) {
      return { ok: false as const, errors: validated.errors };
    }
    deps.store.saveTriggerConfig(validated.value);
    deps.onConfigUpdated(validated.value);
    return { ok: true as const, config: validated.value };
  });

  ipcMain.handle(IpcChannel.GetStats, () => deps.store.loadStats());

  // changes/0010: キャラ作成フォームの保存。生成は行わない(別 change)。
  ipcMain.handle(IpcChannel.SaveCharacter, (_event, raw: unknown): SaveCharacterResult => {
    const validated = validateCharacterProfile(raw);
    if (!validated.ok) return { ok: false, errors: validated.errors };
    try {
      deps.store.saveCharacter(validated.value);
      return { ok: true };
    } catch (error) {
      // シナリオ: 保存に失敗した場合 [異常系] — クラッシュせず失敗を返す
      console.error("saveCharacter failed", error);
      return { ok: false, errors: ["failed to persist the character"] };
    }
  });

  // changes/0010: 話者一覧。VOICEVOX 未起動でも unavailable を返すだけで落ちない。
  ipcMain.handle(
    IpcChannel.GetSpeakers,
    async (): Promise<GetSpeakersResult> => await fetchSpeakers(),
  );
}
