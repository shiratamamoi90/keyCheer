// 総合(経路): 起動時のテーマの読み込み → 設定画面でダークを選ぶ → main の信頼境界で検証 → 永続化 →
// 次の起動で読み直してもダーク。OS の設定の変化はメインウィンドウにすぐ届き、light を選んでいれば効かない(論点 0057)。
// 単体で縛った分岐(定義域・既定値)は再検査しない。総合テストにシナリオ ID は付けない。
// electron の ipcMain は登録された handler を捕まえる最小の偽物に置き換える。

import { describe, it, expect, vi } from "vitest";

type IpcHandler = (event: unknown, arg: unknown) => unknown;

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}));

const { registerIpcHandlers } = await import("../../src/main/ipc.js");
const { createAppStore } = await import("../../src/main/store.js");
const { IpcChannel } = await import("../../src/core/shared/ipc.js");
const { createThemeController } = await import("../../src/renderer/theme.js");

type StoreLike = Parameters<typeof createAppStore>[0];
type Snapshot = { theme: "system" | "light" | "dark"; isOsDark: boolean };

function fakeStore(raw: Record<string, unknown>): StoreLike {
  return {
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
    delete: ((key: string) => {
      delete raw[key];
    }) as StoreLike["delete"],
  };
}

function boot(raw: Record<string, unknown>, osDark: { value: boolean }) {
  handlers.clear();
  registerIpcHandlers({
    store: createAppStore(fakeStore(raw)),
    isOsDark: () => osDark.value,
    onConfigUpdated: () => {},
    onPopupDisplayUpdated: () => {},
    onPopupPointer: () => {},
  });
  return (channel: string, arg?: unknown): unknown => handlers.get(channel)!({}, arg);
}

// mainEntry と同じ受け渡し:Get の結果でコントローラを作り、保存は SetTheme へ流す
function openMainWindow(invoke: (channel: string, arg?: unknown) => unknown) {
  const snapshot = invoke(IpcChannel.GetTheme) as Snapshot;
  const applied: string[] = [];
  const controller = createThemeController({
    setting: snapshot.theme,
    isOsDark: snapshot.isOsDark,
    apply: (theme) => applied.push(theme),
    save: (next) => invoke(IpcChannel.SetTheme, next),
  });
  return { controller, applied };
}

describe("総合: テーマの選択 → 保存 → 次の起動 / OS の変化", () => {
  it("選んだダークが永続化されて次の起動でも効き、light を選べば OS の変化に従わない", () => {
    const raw: Record<string, unknown> = { popup: { shouldAlwaysShow: true } };
    const osDark = { value: false };

    // 起動(既定 system・OS はライト)→ ライト
    let invoke = boot(raw, osDark);
    let window = openMainWindow(invoke);
    expect(window.applied).toEqual(["light"]);

    // OS がダークに → すぐダーク
    window.controller.onOsChanged(true);
    expect(window.applied.at(-1)).toBe("dark");

    // 不正な値は main が拒否して保存しない
    expect(invoke(IpcChannel.SetTheme, "sepia")).toMatchObject({ ok: false });
    expect(raw.ui).toBeUndefined();

    // 設定画面でダーク → 永続化
    window.controller.onSettingChanged("dark");
    expect(raw.ui).toEqual({ theme: "dark" });
    expect(raw.popup).toEqual({ shouldAlwaysShow: true });

    // 次の起動(OS はライト)でもダーク
    osDark.value = false;
    invoke = boot(raw, osDark);
    window = openMainWindow(invoke);
    expect(window.applied).toEqual(["dark"]);

    // light を選ぶと OS がダークになってもライトのまま
    window.controller.onSettingChanged("light");
    window.controller.onOsChanged(true);
    expect(window.applied.at(-1)).toBe("light");
  });
});
