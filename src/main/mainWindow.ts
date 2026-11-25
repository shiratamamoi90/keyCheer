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
import { PRELOAD_PATH } from "./preloadPath.js";
import { loadAppIcon } from "./appIcon.js";
import { IpcChannel } from "../core/shared/ipc.js";
import type { Character, Onboarding } from "../core/shared/types.js";
import { logError } from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_INDEX = join(__dirname, "../renderer/main.html");

export interface MainWindowDeps {
  // 呼び出しの都度ストアから読む(保存・削除のたびに「作成済み」が変わるため)。
  getCharacters: () => Character[];
  getOnboarding: () => Onboarding;
  saveOnboarding: (onboarding: Onboarding) => void;
  // アプリの終了中か(app の before-quit の後)。終了中は閉じるのを止めない
  isQuitting: () => boolean;
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
  // 論点 0077 アプリのアイコン(画像が届くまでは Electron の既定のまま)
  const icon = loadAppIcon();
  const win = new BrowserWindow({
    ...(icon.isEmpty() ? {} : { icon }),
    // 切り替え画面で一覧の横に 3 枚を並べる(論点 0050 S0050_01)ので、一覧と 3 枚が横に収まる幅にする(論点 0058)
    width: 820,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 既定のメニュー(File / Edit …)は外す。操作はタブとボタンで完結させる。
  // 入力欄のコピー・貼り付け(Ctrl+C / Ctrl+V)は Chromium 側が持つのでメニューが無くても効く。
  win.removeMenu();

  // シナリオ: ウィンドウを閉じても常駐は続く / 未作成のまま閉じるとダイアログが出る
  win.on("close", (event) => {
    // 終了(トレイの「終了」= app.quit)のときは閉じさせる。止めると終了そのものが取り消される
    if (deps.isQuitting()) return;
    // S0018_05 即座に hide する — 既定の動作(窓の破棄)は必ず止める。止めないと隠した直後に窓が破棄され、
    // 次にトレイから開くと破棄済みの窓に触れて落ちる(TypeError: Object has been destroyed)
    event.preventDefault();
    const decision = decideOnMainWindowClose(deps.getCharacters());
    if (decision === "hide") {
      win.hide();
      return;
    }
    // ダイアログ表示中はまだ閉じない(既定動作を止めたうえで非同期で確認する)。
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
        logError("メインウィンドウの終了確認に失敗しました", err);
        win.hide();
      });
  });

  // S0033_05 最初の画面を決め直すのは非表示から表示にしたときだけ
  // Electron の show は非表示 → 表示の遷移でだけ発火する。表示中に重ねた表示要求(S0018_09)では
  // 発火しないので、開いている画面は変わらない。中身(一覧・最初の画面)は renderer が組み立てる。
  win.on("show", () => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannel.MainWindowShown);
  });

  win.loadFile(MAIN_INDEX).catch((err: unknown) => {
    // シナリオ: メインウィンドウの読み込みに失敗した場合 [異常系]
    // 発動経路(キー押下 → ポップアップ)には影響させない。ログのみ残す。
    logError("メインウィンドウの読み込みに失敗しました", err);
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
      if (shouldAutoShowMainWindow(deps.getCharacters(), deps.getOnboarding())) {
        win.show();
        win.focus();
      }
    },
    toggle() {
      toggleMainWindow(handle);
    },
  };
}
