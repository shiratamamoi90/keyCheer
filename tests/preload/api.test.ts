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
    expect(Object.keys(api).sort()).toEqual([
      "cancelGeneration",
      "getCharacter",
      "getConsent",
      "getProviders",
      "getSpeakers",
      "getStats",
      "getTriggerConfig",
      "grantConsent",
      "onCheerFired",
      "onConfigMigrated",
      "onGenerationProgress",
      "saveCharacter",
      "setProviders",
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

    await api.getStats();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannel.GetStats);
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

describe("preload / 同意ダイアログに ToS リンクと必須チェック", () => {
  it("S0016_04 bridges grantConsent to its own channel with the provider id", async () => {
    const ipc = fakeIpc();
    await createKeyCheerApi(ipc).grantConsent("openai");
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannel.GrantConsent, "openai");
  });

  it("bridges getConsent without arguments", async () => {
    const ipc = fakeIpc();
    await createKeyCheerApi(ipc).getConsent();
    expect(ipc.invoke).toHaveBeenCalledWith(IpcChannel.GetConsent);
  });

  it("keeps consent off the cheer channels [不変条件]", () => {
    // 同意は生成側の関心。発動経路のチャンネルに相乗りさせない。
    expect(IpcChannel.GrantConsent).not.toBe(IpcChannel.CheerFired);
    expect(IpcChannel.GetConsent).not.toBe(IpcChannel.CheerFired);
  });
});
