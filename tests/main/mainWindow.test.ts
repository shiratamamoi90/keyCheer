// main/mainWindow: メインウィンドウの生成・表示アダプタ。
// 要件: docs/main-window.md(重複表示の防止 / メインウィンドウの読み込みに失敗した場合)
//
// 表示可否の決定ロジックは mainWindowController(Electron 非依存)側でテスト済み。
// ここで縛るのは electron の実体に触れる部分だけ:窓を 1 つしか作らないこと、
// 読み込み失敗を握り潰さずログに留めること。BrowserWindow / dialog は偽物に置き換える。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Character, Onboarding } from "../../src/core/shared/types.js";

const { created, state } = vi.hoisted(() => ({
  created: [] as {
    visible: boolean;
    shows: number;
    hides: number;
    focuses: number;
  }[],
  state: { loadFileRejection: null as Error | null },
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    visible = false;
    shows = 0;
    hides = 0;
    focuses = 0;
    constructor() {
      created.push(this);
    }
    on(): void {}
    show(): void {
      this.visible = true;
      this.shows += 1;
    }
    hide(): void {
      this.visible = false;
      this.hides += 1;
    }
    focus(): void {
      this.focuses += 1;
    }
    isVisible(): boolean {
      return this.visible;
    }
    async loadFile(): Promise<void> {
      if (state.loadFileRejection !== null) throw state.loadFileRejection;
    }
  },
  dialog: { showMessageBox: async () => ({ checkboxChecked: false }) },
}));

const { createMainWindow } = await import("../../src/main/mainWindow.js");

const NO_CHARACTER: Character | undefined = undefined; // 未作成 = 自動表示の対象
const ONBOARDING: Onboarding = { skipMainWindowAutoShow: false };

function deps() {
  return {
    getCharacter: () => NO_CHARACTER,
    getOnboarding: () => ONBOARDING,
    saveOnboarding: () => {},
  };
}

beforeEach(() => {
  created.length = 0;
  state.loadFileRejection = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mainWindow / 重複表示の防止", () => {
  it("S0018_09 reuses the single window when show requests overlap", () => {
    const mainWindow = createMainWindow(deps());

    // 起動時の自動表示とトレイクリックが短時間に重なった状況。
    mainWindow.showIfNeeded();
    mainWindow.showIfNeeded();
    mainWindow.toggle(); // 表示中 → 隠す
    mainWindow.toggle(); // 非表示 → 出し直す

    expect(created).toHaveLength(1); // 窓を作り直さない(2 つ目が生えるとトレイからも閉じられなくなる)
    const win = created[0]!;
    expect(win.visible).toBe(true);
    expect(win.focuses).toBeGreaterThan(0); // 既存の窓を前面に出すだけに留める
  });
});

describe("mainWindow / メインウィンドウの読み込みに失敗した場合", () => {
  it("S0018_10 logs the failure and still allows the window to be shown", async () => {
    state.loadFileRejection = new Error("ENOENT main.html");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const mainWindow = createMainWindow(deps());
    await Promise.resolve(); // loadFile の rejection を処理させる

    expect(errorLog).toHaveBeenCalledTimes(1); // ログのみ。ユーザーへの通知はしない
    expect(() => mainWindow.showIfNeeded()).not.toThrow(); // 落ちない = 発動経路も止まらない
    expect(created).toHaveLength(1);
  });
});
