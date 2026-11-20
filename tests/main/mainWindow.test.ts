// main/mainWindow: メインウィンドウの生成・表示アダプタ。
// 要件: docs/main-window.md(重複表示の防止 / メインウィンドウの読み込みに失敗した場合)
//
// 表示可否の決定ロジックは mainWindowController(Electron 非依存)側でテスト済み。
// ここで縛るのは electron の実体に触れる部分だけ:窓を 1 つしか作らないこと、
// 読み込み失敗を握り潰さずログに留めること。BrowserWindow / dialog は偽物に置き換える。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Character, Onboarding } from "../../src/core/shared/types.js";

type Listener = (event: { preventDefault: () => void }) => void;

const { created, state, dialogCalls } = vi.hoisted(() => ({
  created: [] as {
    visible: boolean;
    shows: number;
    hides: number;
    focuses: number;
    menuRemoved: boolean;
    listeners: Map<string, Listener>;
  }[],
  state: { loadFileRejection: null as Error | null },
  dialogCalls: { count: 0 },
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    visible = false;
    shows = 0;
    hides = 0;
    focuses = 0;
    menuRemoved = false;
    listeners = new Map<string, Listener>();
    constructor() {
      created.push(this);
    }
    on(name: string, listener: Listener): void {
      this.listeners.set(name, listener);
    }
    removeMenu(): void {
      this.menuRemoved = true;
    }
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
  dialog: {
    showMessageBox: async () => {
      dialogCalls.count += 1;
      return { checkboxChecked: false };
    },
  },
}));

const { createMainWindow } = await import("../../src/main/mainWindow.js");

const NO_CHARACTERS: Character[] = []; // 未作成 = 自動表示の対象
const ONE_CHARACTER = [
  { id: "char-1", name: "A", personality: "p", voicevoxSpeakerId: 2 },
] as Character[];
const ONBOARDING: Onboarding = { skipMainWindowAutoShow: false };

function deps(overrides: { characters?: Character[]; isQuitting?: boolean } = {}) {
  return {
    getCharacters: () => overrides.characters ?? NO_CHARACTERS,
    getOnboarding: () => ONBOARDING,
    saveOnboarding: () => {},
    isQuitting: () => overrides.isQuitting ?? false,
  };
}

// × で閉じる(close イベント)。既定の動作を止めたかを返す
function closeWindow(): boolean {
  const preventDefault = vi.fn();
  created[0]!.listeners.get("close")!({ preventDefault });
  return preventDefault.mock.calls.length > 0;
}

beforeEach(() => {
  created.length = 0;
  state.loadFileRejection = null;
  dialogCalls.count = 0;
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

// 既定のメニュー(File / Edit …)は使わない。画面の操作はタブとボタンで完結させる。
describe("mainWindow / メニューを出さない", () => {
  it("removes the default menu bar from the main window", () => {
    createMainWindow(deps());

    expect(created[0]?.menuRemoved).toBe(true);
  });
});

// 回帰:作成済みで × を押すと窓が破棄され、次にトレイから開くと
// 「TypeError: Object has been destroyed」で落ちていた(S0018_05 は「即座に hide する」)
describe("mainWindow / 作成済みなら閉じても窓を残して隠す", () => {
  it("prevents the default close so the hidden window can be reopened from the tray", () => {
    const mainWindow = createMainWindow(deps({ characters: ONE_CHARACTER }));
    mainWindow.toggle(); // トレイから開く

    const isPrevented = closeWindow();

    expect(isPrevented).toBe(true); // 既定の動作(破棄)を止める
    expect(created[0]!.visible).toBe(false);
    expect(dialogCalls.count).toBe(0);
  });
});

// 閉じるのを止めると、トレイの「終了」(app.quit)まで止まる。終了中は止めない
describe("mainWindow / 終了中は閉じるのを止めない", () => {
  it("lets the window close without a dialog while the app is quitting", () => {
    createMainWindow(deps({ characters: NO_CHARACTERS, isQuitting: true }));

    const isPrevented = closeWindow();

    expect(isPrevented).toBe(false);
    expect(dialogCalls.count).toBe(0);
  });
});
