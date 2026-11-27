// preload/api: renderer へ公開する最小 API の形。
// spec: 論点 0017「preload が公開する API は最小 [不変条件]」
//        「入力内容は renderer に渡らない [不変条件]」
// contextBridge への登録そのものは I/O グルー。ここでは ipc を注入して API オブジェクトの
// 形と橋渡しの挙動(Electron のイベントオブジェクトを renderer に漏らさない)を縛る。

import { describe, it, expect, vi } from "vitest";
import { createKeyCheerApi, type IpcLike } from "../../src/preload/api.js";
import { IpcChannel } from "../../src/core/shared/ipc.js";
import { DEFAULT_TRIGGER_CONFIG } from "../../src/core/shared/types.js";

function fakeIpc(): IpcLike & {
  listeners: Map<string, ((event: unknown, ...args: unknown[]) => void)[]>;
  invoke: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, ((event: unknown, ...args: unknown[]) => void)[]>();
  return {
    listeners,
    invoke: vi.fn(async () => DEFAULT_TRIGGER_CONFIG),
    on(channel, listener) {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    removeListener(channel, listener) {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((l) => l !== listener),
      );
    },
  };
}

describe("preload / preload が公開する API は最小 [不変条件]", () => {
  it("S0017_07 exposes exactly the documented functions and nothing else", () => {
    const api = createKeyCheerApi(fakeIpc());
    // 0010 で saveCharacter / getSpeakers を追加(キャラ作成フォーム用)。
    // 追加してもなお Node / Electron のオブジェクトは露出させない。
    // 0032 / 0033 で一覧・削除・切り替え・生成の設定・表示の通知を追加し、getCharacter を外した。
    // 0036 で常時表示の設定(取得・変更)と待機画像の通知を追加した。
    // 0052 でキャラの窓のポインタの通知(絵をつかんで動かす)を追加した。
    // 0047 で画像の重みのライセンスの全文を追加した(取得の口は 0055 で外した)。
    // 0054 で外部プロバイダーの選択と同意を外した。0057 でテーマ(取得・変更・OS の変化の通知)を追加した。
    // 0050 で画像だけ作り直す(開始・進捗の通知)と、画像を作れるかの問い合わせを追加した。
    expect(Object.keys(api).sort()).toEqual([
      "activateCharacter",
      "canMakeImages",
      "cancelGeneration",
      "deleteCharacter",
      "getGenerationConfig",
      "getPopupDisplay",
      "getSpeakers",
      "getTheme",
      "getTriggerConfig",
      "listCharacters",
      "onCharacterDisplay",
      "onCheerFired",
      "onConfigMigrated",
      "onGenerationProgress",
      "onImageRegenerationProgress",
      "onMainWindowShown",
      "onOsThemeChanged",
      "regenerateImages",
      "saveCharacter",
      "sendPopupPointer",
      "setGenerationConfig",
      "setPopupDisplay",
      "setTheme",
      "startGeneration",
      "updateTriggerConfig",
    ]);
    for (const value of Object.values(api)) {
      expect(typeof value).toBe("function");
    }
  });

  it("does not leak the ipc object / Node globals to the renderer", () => {
    const ipc = fakeIpc();
    const api = createKeyCheerApi(ipc);
    for (const value of Object.values(api) as unknown[]) {
      expect(value).not.toBe(ipc);
    }
    const serialized = Object.keys(api).join(",");
    expect(serialized).not.toMatch(/ipcRenderer|require|process|fs/);
  });
});

describe("preload / IPC の橋渡し", () => {
  it("routes reads and writes to the documented channels", async () => {
    const ipc = fakeIpc();
    const api = createKeyCheerApi(ipc);

    await api.getTriggerConfig();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannel.GetTriggerConfig);

    await api.updateTriggerConfig(DEFAULT_TRIGGER_CONFIG);
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannel.UpdateTriggerConfig, DEFAULT_TRIGGER_CONFIG);
  });

  it("S0017_09 入力内容は renderer に渡らない: hands the listener the payload only (not the Electron event)", () => {
    const ipc = fakeIpc();
    const api = createKeyCheerApi(ipc);
    const received: unknown[] = [];
    api.onCheerFired((p) => received.push(p));

    const payload = { message: "やったね!", wavPath: null };
    const electronEvent = { sender: "SHOULD NOT REACH RENDERER" };
    for (const l of ipc.listeners.get(IpcChannel.CheerFired) ?? []) {
      l(electronEvent, payload);
    }

    expect(received).toEqual([payload]);
    expect(received).not.toContain(electronEvent);
  });

  it("returns an unsubscribe function that detaches the listener", () => {
    const ipc = fakeIpc();
    const api = createKeyCheerApi(ipc);
    const seen: unknown[] = [];
    const off = api.onConfigMigrated((p) => seen.push(p));
    off();
    for (const l of ipc.listeners.get(IpcChannel.ConfigMigrated) ?? []) {
      l({}, { field: "regular", from: 100, to: 50 });
    }
    expect(seen).toEqual([]);
  });
});
