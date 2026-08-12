// main/mainWindowController: メインウィンドウの表示/非表示の決定ロジック。
// spec: 論点 0018
// Electron を import しないため決定的にテストできる(BrowserWindow はフェイクの MainWindowHandle で代替)。

import { describe, it, expect } from "vitest";
import {
  shouldAutoShowMainWindow,
  toggleMainWindow,
  decideOnMainWindowClose,
  applyCloseConfirmation,
  type MainWindowHandle,
} from "../../src/main/mainWindowController.js";
import type { Character, Onboarding } from "../../src/core/shared/types.js";

const COMPLETE: Character = {
  id: "char-test",
  name: "チア",
  personality: "元気いっぱい",
  imagePaths: { normal: "n.png" },
  voicevoxSpeakerId: 3,
  generatedBy: { text: "local-ollama", voice: "local-voicevox", image: "local-sdcpp" },
};
const NOT_SKIPPED: Onboarding = { skipMainWindowAutoShow: false };
const SKIPPED: Onboarding = { skipMainWindowAutoShow: true };

describe("mainWindowController / キャラクター未作成なら起動時にメインウィンドウを表示する", () => {
  it("S0018_01 returns true when no character exists and auto-show is not skipped", () => {
    expect(shouldAutoShowMainWindow(undefined, NOT_SKIPPED)).toBe(true);
  });
});

describe("mainWindowController / キャラクター作成済みなら起動時にメインウィンドウを表示しない", () => {
  it("S0018_02 returns false once a character exists", () => {
    expect(shouldAutoShowMainWindow(COMPLETE, NOT_SKIPPED)).toBe(false);
  });
});

describe("mainWindowController / スキップ済みなら未作成でも起動時に表示しない", () => {
  it("S0018_03 returns false when skipMainWindowAutoShow is true, even with no character", () => {
    expect(shouldAutoShowMainWindow(undefined, SKIPPED)).toBe(false);
  });
});

function fakeHandle(initiallyVisible: boolean): MainWindowHandle & {
  calls: string[];
} {
  let visible = initiallyVisible;
  const calls: string[] = [];
  return {
    calls,
    isVisible: () => visible,
    show: () => {
      visible = true;
      calls.push("show");
    },
    hide: () => {
      visible = false;
      calls.push("hide");
    },
    focus: () => calls.push("focus"),
  };
}

describe("mainWindowController / トレイクリックで表示/非表示をトグルする", () => {
  it("S0018_04 shows and focuses a hidden window", () => {
    const win = fakeHandle(false);
    toggleMainWindow(win);
    expect(win.calls).toEqual(["show", "focus"]);
    expect(win.isVisible()).toBe(true);
  });

  it("hides a visible window without touching focus", () => {
    const win = fakeHandle(true);
    toggleMainWindow(win);
    expect(win.calls).toEqual(["hide"]);
    expect(win.isVisible()).toBe(false);
  });
});

describe("mainWindowController / スキップ済みでもトレイからは開ける", () => {
  it("S0018_08 shows a hidden window regardless of skipMainWindowAutoShow", () => {
    // スキップは自動表示のみを抑制する。手動オープンの経路は onboarding を参照しない。
    expect(shouldAutoShowMainWindow(undefined, SKIPPED)).toBe(false);
    const win = fakeHandle(false);
    toggleMainWindow(win);
    expect(win.calls).toEqual(["show", "focus"]);
    expect(win.isVisible()).toBe(true);
  });
});

describe("mainWindowController / 作成済みなら閉じてもダイアログを出さない", () => {
  it("S0018_05 decides to hide directly when a character exists", () => {
    expect(decideOnMainWindowClose(COMPLETE)).toBe("hide");
  });
});

describe("mainWindowController / 未作成のまま閉じるとダイアログが出る", () => {
  it("S0018_06 decides to confirm when no character exists yet", () => {
    expect(decideOnMainWindowClose(undefined)).toBe("confirm");
  });
});

describe("mainWindowController / ダイアログの選択でスキップフラグが決まる", () => {
  it("S0018_07 keeps skipMainWindowAutoShow false when the box is unchecked", () => {
    expect(applyCloseConfirmation(false, NOT_SKIPPED)).toEqual({
      skipMainWindowAutoShow: false,
    });
  });

  it("persists skipMainWindowAutoShow as true when the box is checked", () => {
    expect(applyCloseConfirmation(true, NOT_SKIPPED)).toEqual({
      skipMainWindowAutoShow: true,
    });
  });
});
