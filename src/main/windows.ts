// windows: BrowserWindow 生成の薄いアダプタ(応援ポップアップ)。
// spec: 論点 0017「ポップアップは入力の邪魔をしない [不変条件]」
// この層は core/providers を import しない(UI 側は core を「使う側」)。
// 設定ウィンドウは本スライスに含めない(設定 UI の change で追加する)。

import { BrowserWindow, screen } from "electron";
import { POPUP_WINDOW_SIZE, type Point, type WorkArea } from "../core/shared/popupLayout.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRELOAD_PATH } from "./preloadPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ビルド出力(dist/)基準のパス。dist/main/ から見た相対位置。
const POPUP_INDEX = join(__dirname, "../renderer/popup.html");

// 応援ポップアップ(キャラの窓):枠なし・透過・常に最前面・タスクバー非表示。
// 大きさは core/shared/popupLayout が正本(絵とセリフの配置を renderer と同じ値で決めるため。論点 0052)。
// 位置は呼び出し側が resolvePopupPosition で決めて渡す(覚えた位置か、既定の右下。S0052_02 / S0052_06 / S0052_07)。
export function createPopupWindow(position: Point): BrowserWindow {
  const win = new BrowserWindow({
    width: POPUP_WINDOW_SIZE.width,
    height: POPUP_WINDOW_SIZE.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // 打鍵中に前面へ出てもフォーカスを奪わない
    resizable: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true, // レンダラに Node を露出しない(最小権限)
      nodeIntegration: false,
      // ESM の preload を読むために必要(Electron の制約)。
      // contextIsolation は維持しているので、renderer から見えるのは preload が公開した 5 関数だけ。
      sandbox: false,
    },
  });
  setPopupCaptureMouse(win, false); // 入力の邪魔をしない(打鍵中に前面へ出るため)
  win.loadFile(POPUP_INDEX).catch((err: unknown) => {
    // シナリオ: renderer の読み込みに失敗した場合 [異常系]
    // ログのみ残し、ユーザーへは通知しない(docs/popup.md)。表示だけが失われ、
    // キーカウント・統計の記録は続く。`void` で捨てると未処理 rejection で
    // プロセスごと落ち、記録の継続という要件を破る。
    console.error("[keycheer] ポップアップの読み込みに失敗しました", err);
  });
  return win;
}

// S0036_25 常時表示の窓も入力の邪魔をしない / S0036_24 常時表示を切ると窓を出さない
// show() / focus() を使わないのは、打鍵中に前面へ出たときフォーカスを奪うため(S0017_06 と同じ理由)。
// クリック透過は表示し直すたびに当て直す(常に出ている窓が誤クリックを受けないように)。
export function applyAlwaysShow(win: BrowserWindow, shouldAlwaysShow: boolean): void {
  if (win.isDestroyed()) return;
  if (shouldAlwaysShow) {
    setPopupCaptureMouse(win, false);
    win.showInactive();
  } else {
    win.hide();
  }
}

// S0052_03 ポインタが絵の上にある間だけマウスを受け取る
// クリックを通している間も forward でポインタの動きだけは renderer に届ける。届かないと、
// ポインタが絵の上に入ったことを renderer が知れず、受け取る状態へ切り替えられない(Windows / macOS で効く)。
export function setPopupCaptureMouse(win: BrowserWindow, shouldCapture: boolean): void {
  if (win.isDestroyed()) return;
  if (shouldCapture) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
}

// 全画面の作業領域。先頭は主画面(resolvePopupPosition は先頭を既定の位置の画面に使う)
export function getWorkAreas(): WorkArea[] {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
  return [primary, ...others].map((display) => ({ ...display.workArea }));
}
