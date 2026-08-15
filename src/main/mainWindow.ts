// mainWindow: メインウィンドウ(将来キャラ作成 UI を載せる場所)の生成・表示/非表示アダプタ。
// spec: 論点 0018
// 決定ロジックは mainWindowController(Electron 非依存・テスト対象)に委譲し、ここは
// BrowserWindow / dialog の実体を注入する薄い I/O グルーに徹する。
//
// electron に触れる部分(窓を 1 つしか作らない / 読み込み失敗をログに留める)は
// BrowserWindow を偽物に差し替えて tests/main/mainWindow.test.ts で縛る。

import { BrowserWindow, dialog } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  shouldAutoShowMainWindow,
  toggleMainWindow,
  decideOnMainWindowClose,
  applyCloseConfirmation,
  type MainWindowHandle,
} from "./mainWindowController.js";
import type { Character, Onboarding } from "../core/shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = join(__dirname, "../preload/index.mjs");
const MAIN_INDEX = join(__dirname, "../renderer/main.html");

export interface MainWindowDeps {
  // 呼び出しの都度ストアから読む(キャラ作成フロー本体が書き込むまでは常に undefined / 既定値)。
  getCharacter: () => Character | undefined;
  getOnboarding: () => Onboarding;
  saveOnboarding: (onboarding: Onboarding) => void;
}

export interface MainWindow {
  win: BrowserWindow;
  // 起動時の自動表示判定(シナリオ: キャラクター未作成/作成済み/スキップ済み)
  showIfNeeded(): void;
  // トレイクリック(シナリオ: トレイクリックで表示する/隠す)
  toggle(): void;
}

// 単一インスタンスのみ生成する(index.ts から 1 回だけ呼ぶ想定)。
// showIfNeeded / toggle はいずれもこの同じ win を操作するだけなので、二重生成は起きない
// (シナリオ: 重複表示の防止)。
export function createMainWindow(deps: MainWindowDeps): MainWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 640,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // シナリオ: ウィンドウを閉じても常駐は続く / 未作成のまま閉じるとダイアログが出る
  win.on("close", (event) => {
    const decision = decideOnMainWindowClose(deps.getCharacter());
    if (decision === "hide") {
      win.hide();
      return;
    }
    // ダイアログ表示中はまだ閉じない(既定動作を止めてから非同期で確認する)。
    event.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: "question",
        buttons: ["閉じる"],
        message: "キャラクターがまだ作成されていません",
        checkboxLabel: "次回から自動的に表示しない",
        checkboxChecked: false,
      })
      .then((result) => {
        deps.saveOnboarding(applyCloseConfirmation(result.checkboxChecked, deps.getOnboarding()));
        win.hide();
      })
      .catch((err: unknown) => {
        console.error("[keycheer] メインウィンドウの終了確認に失敗しました", err);
        win.hide();
      });
  });

  win.loadFile(MAIN_INDEX).catch((err: unknown) => {
    // シナリオ: メインウィンドウの読み込みに失敗した場合 [異常系]
    // 発動経路(キー押下 → ポップアップ)には影響させない。ログのみ残す。
    console.error("[keycheer] メインウィンドウの読み込みに失敗しました", err);
  });

  const handle: MainWindowHandle = {
    isVisible: () => win.isVisible(),
    show: () => win.show(),
    hide: () => win.hide(),
    focus: () => win.focus(),
  };

  return {
    win,
    showIfNeeded() {
      if (shouldAutoShowMainWindow(deps.getCharacter(), deps.getOnboarding())) {
        win.show();
        win.focus();
      }
    },
    toggle() {
      toggleMainWindow(handle);
    },
  };
}
