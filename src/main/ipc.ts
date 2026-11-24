// ipc: main 側の IPC ハンドラ登録。renderer からの設定取得/更新・統計取得を捌く。
// 設定更新は core で検証してから永続化し、発動中の cheerRuntime へ即時反映する。
// チャンネル名の正本は shared/ipc.ts(main/renderer が同じ定数を参照)。

import { ipcMain } from "electron";
import { validateTriggerConfig } from "../core/index.js";
import { IpcChannel } from "../core/shared/ipc.js";
import type { AppStore } from "./store.js";
import type { TriggerConfig } from "../core/shared/types.js";
import type {
  GetSpeakersResult,
  SaveCharacterResult,
  SaveGenerationConfigResult,
} from "../core/shared/ipc.js";
import type { GenerationConfig, PopupDisplayConfig, ThemeSetting } from "../core/shared/types.js";
import type { SavePopupDisplayResult, SaveThemeResult, ThemeSnapshot } from "../core/shared/ipc.js";
import { validateThemeSetting } from "../core/themeConfig.js";
import { validatePopupDisplayConfig } from "../core/popupDisplayConfig.js";
import { fetchSpeakers } from "./speakerCatalog.js";
// 信頼境界の検証は electron 非依存の別モジュールに置く(テストで縛るため)。
import { validateCharacterProfile } from "./characterInput.js";
import { validateGenerationConfig } from "../core/generationConfig.js";

export interface IpcDeps {
  store: AppStore;
  // 更新された設定を発動経路へ即時反映する(store 永続化とは別に RuntimeState 側へ)
  onConfigUpdated: (config: TriggerConfig) => void;
  // OS の設定がダークか(Electron の nativeTheme。テーマ S0057_01)
  isOsDark: () => boolean;
  // 常時表示の変更を窓へ即時反映する(再起動なしで出す・隠す。S0036_29)
  onPopupDisplayUpdated: (config: PopupDisplayConfig) => void;
  // キャラの窓のポインタの通知(論点 0052)。形の検証は受け取る側(main/popupPointer)が行う
  onPopupPointer: (raw: unknown) => void;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle(IpcChannel.GetTriggerConfig, () => deps.store.loadTriggerConfig().config);

  ipcMain.handle(IpcChannel.UpdateTriggerConfig, (_event, raw: unknown) => {
    // 信頼境界:renderer からの入力は必ず core で検証(security-rules.md「入力と信頼境界」)。
    const validated = validateTriggerConfig(raw);
    if (!validated.ok) {
      return { ok: false as const, errors: validated.errors };
    }
    deps.store.saveTriggerConfig(validated.value);
    deps.onConfigUpdated(validated.value);
    return { ok: true as const, config: validated.value };
  });

  ipcMain.handle(IpcChannel.GetStats, () => deps.store.loadStats());

  // 論点 0019: キャラ作成フォームの保存。生成は行わない(別の論点)。
  // 論点 0032: id 付きなら編集(S0032_04 / S0032_05)、無ければ新規保存(S0032_01 / S0032_03)。
  ipcMain.handle(IpcChannel.SaveCharacter, (_event, raw: unknown): SaveCharacterResult => {
    const validated = validateCharacterProfile(raw);
    if (!validated.ok) return { ok: false, errors: validated.errors };
    const id = (raw as { id?: unknown }).id;
    if (id !== undefined && typeof id !== "string") {
      return { ok: false, errors: ["id must be a string"] };
    }
    try {
      if (id !== undefined) {
        const updated = deps.store.updateCharacter(id, validated.value);
        return updated.ok ? { ok: true } : { ok: false, errors: ["character not found"] };
      }
      const added = deps.store.addCharacter(validated.value);
      if (!added.ok) return { ok: false, errors: ["character limit reached"] };
      return { ok: true };
    } catch (error) {
      // シナリオ: 保存に失敗した場合 [異常系] — クラッシュせず失敗を返す
      console.error("saveCharacter failed", error);
      return { ok: false, errors: ["failed to persist the character"] };
    }
  });

  // 論点 0033: 設定画面の「生成が完了したら使用中にする」
  ipcMain.handle(
    IpcChannel.GetGenerationConfig,
    (): GenerationConfig => deps.store.loadGeneration(),
  );
  ipcMain.handle(
    IpcChannel.SetGenerationConfig,
    (_event, raw: unknown): SaveGenerationConfigResult => {
      // S0033_15 renderer からの設定の変更は main 側で検証する
      const validated = validateGenerationConfig(raw);
      if (!validated.ok) return { ok: false, errors: validated.errors };
      deps.store.saveGeneration(validated.value);
      return { ok: true };
    },
  );

  // 論点 0036: 設定画面の「キャラを常に表示する」
  ipcMain.handle(
    IpcChannel.GetPopupDisplay,
    (): PopupDisplayConfig => deps.store.loadPopupDisplay(),
  );
  ipcMain.handle(IpcChannel.SetPopupDisplay, (_event, raw: unknown): SavePopupDisplayResult => {
    // renderer からの設定の変更は main 側で検証する(S0033_15 と同じ扱い)
    const validated = validatePopupDisplayConfig(raw);
    if (!validated.ok) return { ok: false, errors: validated.errors };
    deps.store.savePopupDisplay(validated.value);
    deps.onPopupDisplayUpdated(validated.value);
    return { ok: true };
  });

  // 論点 0057: テーマ。設定と OS の設定を返し、見た目は renderer が決める
  ipcMain.handle(
    IpcChannel.GetTheme,
    (): ThemeSnapshot => ({ theme: deps.store.loadUiConfig().theme, isOsDark: deps.isOsDark() }),
  );
  ipcMain.handle(IpcChannel.SetTheme, (_event, raw: unknown): SaveThemeResult => {
    // S0057_06 テーマの不正な値は保存しない(renderer からの値は main 側で検証する)
    const errors = validateThemeSetting(raw);
    if (errors.length > 0) return { ok: false, errors };
    deps.store.saveUiConfig({ theme: raw as ThemeSetting });
    return { ok: true };
  });

  // S0052_03 / S0052_05 キャラの窓のポインタ(絵の上に入った・出た・ドラッグ)
  ipcMain.handle(IpcChannel.PopupPointer, (_event, raw: unknown): void => {
    deps.onPopupPointer(raw);
  });

  // 論点 0019: 話者一覧。VOICEVOX 未起動でも unavailable を返すだけで落ちない。
  ipcMain.handle(
    IpcChannel.GetSpeakers,
    async (): Promise<GetSpeakersResult> => await fetchSpeakers(),
  );
}
