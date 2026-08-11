// preload/api: renderer へ公開する最小 API。ipc を注入して組み立てる純粋なファクトリ。
// spec: changes/0007-runnable-popup-slice/spec.md「preload が公開する API は最小 [不変条件]」
// 不変条件:
//   - 公開するのは下記 5 関数のみ。Electron / Node のオブジェクト(ipcRenderer・require・fs 等)は渡さない。
//   - main からのイベントは **ペイロードだけ**を renderer に渡す(IpcRendererEvent を漏らさない)。
//   - providers / agent の生成系には触れない(発動経路の分離)。

import { IpcChannel } from "../shared/ipc.js";
import type {
  CheerFiredPayload,
  CharacterSummaryPayload,
  ConfigMigratedPayload,
  GenerationProgressPayload,
  GetSpeakersResult,
  SaveCharacterRequest,
  SaveCharacterResult,
  StartGenerationResult,
  StatsSnapshot,
  UpdateTriggerConfigRequest,
  ConsentSnapshot,
} from "../shared/ipc.js";
import type { TriggerConfig, ProviderId, ProviderSelection } from "../shared/types.js";

// 保存結果の型は providerStore が正本。preload は形だけ再宣言せず構造で受ける
// (main の実装を preload から import しないため — 発動経路/プロセス境界を跨がせない)。
export type SaveProvidersResult = { ok: true } | { ok: false; errors: string[] };

// Electron `ipcRenderer` のうち本 API が使う部分だけを型で表す(依存を薄く保つ・テストで差し替える)
export interface IpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export type UpdateTriggerConfigResult =
  | { ok: true; config: TriggerConfig }
  | { ok: false; errors: string[] };

export interface KeyCheerApi {
  // 購読解除用の関数を返す
  onCheerFired(listener: (payload: CheerFiredPayload) => void): () => void;
  onConfigMigrated(listener: (payload: ConfigMigratedPayload) => void): () => void;
  getTriggerConfig(): Promise<TriggerConfig>;
  updateTriggerConfig(config: UpdateTriggerConfigRequest): Promise<UpdateTriggerConfigResult>;
  getStats(): Promise<StatsSnapshot>;
  // キャラ作成フォーム(changes/0010)。生成は含まない。
  saveCharacter(profile: SaveCharacterRequest): Promise<SaveCharacterResult>;
  getSpeakers(): Promise<GetSpeakersResult>;
  getCharacter(): Promise<CharacterSummaryPayload | null>;
  // プール・wav の生成(changes/0011)。進捗は onGenerationProgress で流れてくる。
  startGeneration(): Promise<StartGenerationResult>;
  cancelGeneration(): Promise<void>;
  onGenerationProgress(listener: (payload: GenerationProgressPayload) => void): () => void;
  // 外部プロバイダーの同意(changes/0003)。grantConsent は同意ダイアログを
  // 通過した時にだけ呼ぶ — ダイアログの表示・チェック操作では呼ばない。
  getProviders(): Promise<ProviderSelection>;
  setProviders(selection: ProviderSelection): Promise<SaveProvidersResult>;
  getConsent(): Promise<ConsentSnapshot>;
  grantConsent(id: ProviderId): Promise<ConsentSnapshot>;
}

function subscribe<T>(ipc: IpcLike, channel: string, listener: (payload: T) => void): () => void {
  // main の送信は (event, payload)。event は renderer に渡さない。
  const wrapped = (_event: unknown, ...args: unknown[]): void => listener(args[0] as T);
  ipc.on(channel, wrapped);
  return () => ipc.removeListener(channel, wrapped);
}

export function createKeyCheerApi(ipc: IpcLike): KeyCheerApi {
  return {
    onCheerFired: (listener) => subscribe(ipc, IpcChannel.CheerFired, listener),
    onConfigMigrated: (listener) => subscribe(ipc, IpcChannel.ConfigMigrated, listener),
    getTriggerConfig: () => ipc.invoke(IpcChannel.GetTriggerConfig) as Promise<TriggerConfig>,
    updateTriggerConfig: (config) =>
      ipc.invoke(IpcChannel.UpdateTriggerConfig, config) as Promise<UpdateTriggerConfigResult>,
    getStats: () => ipc.invoke(IpcChannel.GetStats) as Promise<StatsSnapshot>,
    saveCharacter: (profile) =>
      ipc.invoke(IpcChannel.SaveCharacter, profile) as Promise<SaveCharacterResult>,
    getSpeakers: () => ipc.invoke(IpcChannel.GetSpeakers) as Promise<GetSpeakersResult>,
    getCharacter: () =>
      ipc.invoke(IpcChannel.GetCharacter) as Promise<CharacterSummaryPayload | null>,
    startGeneration: () => ipc.invoke(IpcChannel.StartGeneration) as Promise<StartGenerationResult>,
    cancelGeneration: () => ipc.invoke(IpcChannel.CancelGeneration) as Promise<void>,
    onGenerationProgress: (listener) => subscribe(ipc, IpcChannel.GenerationProgress, listener),
    getProviders: () => ipc.invoke(IpcChannel.GetProviders) as Promise<ProviderSelection>,
    setProviders: (selection) =>
      ipc.invoke(IpcChannel.SetProviders, selection) as Promise<SaveProvidersResult>,
    getConsent: () => ipc.invoke(IpcChannel.GetConsent) as Promise<ConsentSnapshot>,
    grantConsent: (id) => ipc.invoke(IpcChannel.GrantConsent, id) as Promise<ConsentSnapshot>,
  };
}
