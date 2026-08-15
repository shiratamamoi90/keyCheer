// main/windows: 応援ポップアップの BrowserWindow 生成アダプタ。
// 要件: docs/popup.md(ポップアップは入力の邪魔をしない / renderer の読み込みに失敗した場合)
//
// electron は実プロセスでしか動かないため、BrowserWindow / screen を最小の偽物に置き換える。
// ここで縛るのは**どのオプションで窓を作るか**と**読み込み失敗をどう扱うか**であって、
// Electron が実際にどう描画するかではない(見た目は spec の対象外)。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface WindowOptions {
  frame?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  focusable?: boolean;
  webPreferences?: { contextIsolation?: boolean; nodeIntegration?: boolean };
}

const { created, state } = vi.hoisted(() => ({
  created: [] as { options: WindowOptions; ignoreMouseEvents: boolean[] }[],
  state: { loadFileRejection: null as Error | null },
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    ignoreMouseEvents: boolean[] = [];
    constructor(public options: WindowOptions) {
      created.push(this);
    }
    setIgnoreMouseEvents(value: boolean): void {
      this.ignoreMouseEvents.push(value);
    }
    async loadFile(): Promise<void> {
      if (state.loadFileRejection !== null) throw state.loadFileRejection;
    }
  },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
}));

const { createPopupWindow } = await import("../../src/main/windows.js");

beforeEach(() => {
  created.length = 0;
  state.loadFileRejection = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("windows / ポップアップは入力の邪魔をしない", () => {
  it("S0017_06 creates the popup as non-focusable, click-through and hidden from the taskbar", () => {
    createPopupWindow();

    const { options, ignoreMouseEvents } = created[0]!;
    expect(options.focusable).toBe(false); // 打鍵中にフォーカスを奪わない
    expect(options.skipTaskbar).toBe(true);
    expect(ignoreMouseEvents).toEqual([true]); // クリックを透過する
    // 最小権限(docs/popup.md 不変条件)。ここが崩れると renderer に Node が露出する。
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
  });
});

describe("windows / renderer の読み込みに失敗した場合", () => {
  it("S0017_10 logs the failure and keeps running instead of crashing", async () => {
    state.loadFileRejection = new Error("ENOENT popup.html");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => createPopupWindow()).not.toThrow();
    await Promise.resolve(); // loadFile の rejection を処理させる

    // ユーザーへの通知は行わず、main 側にログを残すだけ(docs/popup.md)。
    // 拒否を捨て置くと未処理 rejection でプロセスごと落ち、統計の記録も止まる。
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1); // 窓自体は残る(次の発動で send しても落ちない)
  });
});
