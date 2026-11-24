// 総合(経路): キャラの窓を、覚えた位置に置く → renderer から届いたポインタの通知を IPC で受ける →
// 絵の上でマウスを受け取り、ドラッグで窓を動かす → 離した位置を保存する → 起動し直すと同じ位置に置く、
// までを 1 本で通す(論点 0052)。
//
// 単体で既に縛った分岐(位置の検証・受け取るかの判定・動かす量)はここで再検査しない。
// ここが守るのは結合部の前提:IPC ハンドラから popupPointer を経て、窓の操作と store の**両方**に届き、
// 保存した値を次の起動の resolvePopupPosition がそのまま使えること。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// electron の ipcMain は実プロセスでしか動かないため、登録された handler を捕まえる偽物に置き換える。
// 窓(BrowserWindow)も、位置とマウスの受け取りだけを覚える偽物にする。

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
const { createPopupPointerHandler } = await import("../../src/main/popupPointer.js");
const { resolvePopupPosition } = await import("../../src/core/shared/popupLayout.js");
const { IpcChannel } = await import("../../src/core/shared/ipc.js");

type StoreLike = Parameters<typeof createAppStore>[0];

const WORK_AREAS = [{ x: 0, y: 0, width: 1536, height: 824 }];

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

/** 起動時の配線を組む(main/index.ts と同じ結線)。窓は位置とマウスの受け取りだけを持つ偽物 */
function bootstrap(raw: Record<string, unknown>) {
  handlers.clear();
  const store = createAppStore(fakeStore(raw));
  const win = {
    position: resolvePopupPosition(store.loadPopupPosition(), WORK_AREAS),
    isCapturingMouse: false,
  };
  const popupPointer = createPopupPointerHandler({
    isImageShown: () => true,
    setCaptureMouse: (shouldCapture) => {
      win.isCapturingMouse = shouldCapture;
    },
    getWindowPosition: () => ({ ...win.position }),
    setWindowPosition: (position) => {
      win.position = position;
    },
    savePosition: (position) => store.savePopupPosition(position),
  });
  registerIpcHandlers({
    store,
    isOsDark: () => false,
    onConfigUpdated: () => {},
    onPopupDisplayUpdated: () => {},
    onPopupPointer: (event) => popupPointer.handle(event),
  });
  const sendPointer = (event: unknown) => handlers.get(IpcChannel.PopupPointer)!({}, event);
  return { win, sendPointer };
}

describe("総合: キャラの窓を絵をつかんで動かし、次の起動で同じ位置に出す", () => {
  it("places the window, drags it over IPC, saves the position and restores it on restart", () => {
    const raw: Record<string, unknown> = {
      popup: { shouldAlwaysShow: true, customPosition: { x: 800, y: 400 } },
    };

    // 起動:覚えた位置に置き、クリックは通している
    const first = bootstrap(raw);
    expect(first.win.position).toEqual({ x: 800, y: 400 });
    expect(first.win.isCapturingMouse).toBe(false);

    // 絵の上に入るとマウスを受け取り、ドラッグで動く
    first.sendPointer({ type: "enter" });
    expect(first.win.isCapturingMouse).toBe(true);
    first.sendPointer({ type: "drag-start", screenX: 900, screenY: 500 });
    first.sendPointer({ type: "drag-move", screenX: 915, screenY: 490 });
    expect(first.win.position).toEqual({ x: 815, y: 390 });
    first.sendPointer({ type: "drag-end", screenX: 930, screenY: 480 });
    first.sendPointer({ type: "leave" });

    // 離した位置に止まり、絵から出るとクリックを通す状態に戻る。位置は popup のほかの設定と並んで保存される
    expect(first.win.position).toEqual({ x: 830, y: 380 });
    expect(first.win.isCapturingMouse).toBe(false);
    expect(raw.popup).toEqual({ shouldAlwaysShow: true, customPosition: { x: 830, y: 380 } });

    // 起動し直すと同じ位置に出る
    const second = bootstrap(raw);
    expect(second.win.position).toEqual({ x: 830, y: 380 });
  });
});
