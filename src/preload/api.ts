// preload/api: renderer へ公開する最小 API。ipc を注入して組み立てる純粋なファクトリ。
// spec: 論点 0017「preload が公開する API は最小 [不変条件]」
// 不変条件:
//   - 公開するのは下記 5 関数のみ。Electron / Node のオブジェクト(ipcRenderer・require・fs 等)は渡さない。
//   - main からのイベントは **ペイロードだけ**を renderer に渡す(IpcRendererEvent を漏らさない)。
//   - providers / agent の生成系には触れない(発動経路の分離)。

import { IpcChannel } from "../core/shared/ipc.js";
import type {
  ActivateCharacterResult,
  CheerFiredPayload,
  CharacterDisplayPayload,
  CharacterListItem,
  ConfigMigratedPayload,
  DeleteCharacterResult,
  SaveGenerationConfigResult,
  SavePopupDisplayResult,
  GenerationProgressPayload,
  PopupPointerEvent,
  GetSpeakersResult,
  SaveCharacterRequest,
  SaveCharacterResult,
  StartGenerationOptions,
  StartGenerationResult,
  StatsSnapshot,
  UpdateTriggerConfigRequest,
  SaveThemeResult,
  RegenerateImagesResult,
  ImageRegenerationProgressPayload,
  ThemeSnapshot,
} from "../core/shared/ipc.js";
import type {
  TriggerConfig,
  ThemeSetting,
  GenerationConfig,
  PopupDisplayConfig,
} from "../core/shared/types.js";

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
  // キャラ作成フォーム(論点 0019)。生成は含まない。id 付きなら編集(論点 0032)。
  saveCharacter(profile: SaveCharacterRequest): Promise<SaveCharacterResult>;
  getSpeakers(): Promise<GetSpeakersResult>;
  // キャラクターの一覧・削除・使用中の切り替え(論点 0032)
  listCharacters(): Promise<CharacterListItem[]>;
  deleteCharacter(characterId: string): Promise<DeleteCharacterResult>;
  activateCharacter(characterId: string): Promise<ActivateCharacterResult>;
  // 設定画面(論点 0033)
  getGenerationConfig(): Promise<GenerationConfig>;
  setGenerationConfig(config: GenerationConfig): Promise<SaveGenerationConfigResult>;
  // 常時表示(論点 0036)。onCharacterDisplay はポップアップが待機画像と常時表示を受け取る口
  getPopupDisplay(): Promise<PopupDisplayConfig>;
  setPopupDisplay(config: PopupDisplayConfig): Promise<SavePopupDisplayResult>;
  onCharacterDisplay(listener: (payload: CharacterDisplayPayload) => void): () => void;
  // キャラの窓のポインタの状態を main に伝える(論点 0052。絵をつかんで窓を動かす)
  sendPopupPointer(event: PopupPointerEvent): void;
  // メインウィンドウが非表示から表示になった(最初の画面を決め直す。論点 0033)
  onMainWindowShown(listener: () => void): () => void;
  // 画像だけ作り直す(論点 0050)。中断は cancelGeneration と共通
  regenerateImages(characterId: string): Promise<RegenerateImagesResult>;
  onImageRegenerationProgress(
    listener: (payload: ImageRegenerationProgressPayload) => void,
  ): () => void;
  canMakeImages(): Promise<boolean>;
  // テーマ(論点 0057)。onOsThemeChanged は OS の設定が変わったときに届く
  getTheme(): Promise<ThemeSnapshot>;
  setTheme(theme: ThemeSetting): Promise<SaveThemeResult>;
  onOsThemeChanged(listener: (isOsDark: boolean) => void): () => void;
  // プール・wav の生成(論点 0020)。進捗は onGenerationProgress で流れてくる。
  startGeneration(
    characterId: string,
    options?: StartGenerationOptions,
  ): Promise<StartGenerationResult>;
  cancelGeneration(): Promise<void>;
  onGenerationProgress(listener: (payload: GenerationProgressPayload) => void): () => void;
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
    listCharacters: () => ipc.invoke(IpcChannel.ListCharacters) as Promise<CharacterListItem[]>,
    deleteCharacter: (characterId) =>
      ipc.invoke(IpcChannel.DeleteCharacter, characterId) as Promise<DeleteCharacterResult>,
    activateCharacter: (characterId) =>
      ipc.invoke(IpcChannel.ActivateCharacter, characterId) as Promise<ActivateCharacterResult>,
    getGenerationConfig: () =>
      ipc.invoke(IpcChannel.GetGenerationConfig) as Promise<GenerationConfig>,
    setGenerationConfig: (config) =>
      ipc.invoke(IpcChannel.SetGenerationConfig, config) as Promise<SaveGenerationConfigResult>,
    getPopupDisplay: () => ipc.invoke(IpcChannel.GetPopupDisplay) as Promise<PopupDisplayConfig>,
    setPopupDisplay: (config) =>
      ipc.invoke(IpcChannel.SetPopupDisplay, config) as Promise<SavePopupDisplayResult>,
    onCharacterDisplay: (listener) => subscribe(ipc, IpcChannel.CharacterDisplay, listener),
    sendPopupPointer: (event) => {
      void ipc.invoke(IpcChannel.PopupPointer, event);
    },
    onMainWindowShown: (listener) => subscribe(ipc, IpcChannel.MainWindowShown, () => listener()),
    regenerateImages: (characterId) =>
      ipc.invoke(IpcChannel.RegenerateImages, characterId) as Promise<RegenerateImagesResult>,
    onImageRegenerationProgress: (listener) =>
      subscribe(ipc, IpcChannel.ImageRegenerationProgress, listener),
    canMakeImages: () => ipc.invoke(IpcChannel.CanMakeImages) as Promise<boolean>,
    getTheme: () => ipc.invoke(IpcChannel.GetTheme) as Promise<ThemeSnapshot>,
    setTheme: (theme) => ipc.invoke(IpcChannel.SetTheme, theme) as Promise<SaveThemeResult>,
    onOsThemeChanged: (listener) => subscribe(ipc, IpcChannel.OsThemeChanged, listener),
    startGeneration: (characterId, options) =>
      ipc.invoke(
        IpcChannel.StartGeneration,
        characterId,
        options ?? {},
      ) as Promise<StartGenerationResult>,
    cancelGeneration: () => ipc.invoke(IpcChannel.CancelGeneration) as Promise<void>,
    onGenerationProgress: (listener) => subscribe(ipc, IpcChannel.GenerationProgress, listener),
  };
}
