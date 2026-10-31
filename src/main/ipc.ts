// ipc: main 側の IPC ハンドラ登録。renderer からの設定取得/更新・統計取得を捌く。
// 設定更新は core で検証してから永続化し、発動中の cheerRuntime へ即時反映する。
// チャンネル名の正本は shared/ipc.ts(main/renderer が同じ定数を参照)。

import { ipcMain } from "electron";
import { validateTriggerConfig } from "../core/index.js";
import { IpcChannel } from "../core/shared/ipc.js";
import type { AppStore } from "./store.js";
import type { ProviderStore, SaveProvidersResult } from "./providerStore.js";
import type { TriggerConfig, ProviderSelection } from "../core/shared/types.js";
import type {
  GetSpeakersResult,
  SaveCharacterResult,
  SaveGenerationConfigResult,
  ConsentSnapshot,
} from "../core/shared/ipc.js";
import type { GenerationConfig } from "../core/shared/types.js";
import { isConsentableProviderId } from "../core/shared/providerDisclosure.js";
import { fetchSpeakers } from "./speakerCatalog.js";
// 信頼境界の検証は electron 非依存の別モジュールに置く(テストで縛るため)。
import { validateCharacterProfile } from "./characterInput.js";
import { validateGenerationConfig } from "../core/generationConfig.js";

export interface IpcDeps {
  store: AppStore;
  // プロバイダー選択・同意はキャラ作成側の関心。store とは別モジュールに分ける
  // (発動経路が読む store.ts に providers を集めない。CLAUDE.md の不変条件)。
  providers: ProviderStore;
  // 更新された設定を発動経路へ即時反映する(store 永続化とは別に RuntimeState 側へ)
  onConfigUpdated: (config: TriggerConfig) => void;
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

  // 論点 0019: 話者一覧。VOICEVOX 未起動でも unavailable を返すだけで落ちない。
  ipcMain.handle(
    IpcChannel.GetSpeakers,
    async (): Promise<GetSpeakersResult> => await fetchSpeakers(),
  );

  // 論点 0016: 外部プロバイダーの選択と同意。発動経路とは無関係のチャンネル。
  ipcMain.handle(IpcChannel.GetProviders, (): ProviderSelection => deps.providers.loadProviders());

  // 信頼境界:renderer から来た選択は providerStore 側で再検証される。
  ipcMain.handle(
    IpcChannel.SetProviders,
    (_event, raw: unknown): SaveProvidersResult =>
      deps.providers.saveProviders(raw as ProviderSelection),
  );

  ipcMain.handle(IpcChannel.GetConsent, (): ConsentSnapshot => deps.providers.loadConsent());

  // シナリオ: 同意ダイアログに ToS リンクと必須チェック(通過した時だけここへ来る)
  // 信頼境界:renderer から来た値を検証せずに書かない。未知・ローカルは黙って無視し、
  // 現在の同意状態をそのまま返す(不正な id で同意を作らせない)。
  ipcMain.handle(IpcChannel.GrantConsent, (_event, raw: unknown): ConsentSnapshot => {
    if (isConsentableProviderId(raw)) deps.providers.grantConsent(raw);
    return deps.providers.loadConsent();
  });
}
