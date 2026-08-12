// windows: BrowserWindow 生成の薄いアダプタ(応援ポップアップ)。
// spec: 論点 0017「ポップアップは入力の邪魔をしない [不変条件]」
// この層は core/providers を import しない(UI 側は core を「使う側」)。
// 設定ウィンドウは本スライスに含めない(設定 UI の change で追加する)。

import { BrowserWindow, screen } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ビルド出力(dist/)基準のパス。dist/main/ から見た相対位置。
// preload は ESM で読ませるため `.mjs`(build スクリプトが拡張子を付け替える)。
const PRELOAD_PATH = join(__dirname, "../preload/index.mjs");
const POPUP_INDEX = join(__dirname, "../renderer/popup.html");

// 応援ポップアップ:枠なし・透過・常に最前面・タスクバー非表示。
export function createPopupWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const popupWidth = 320;
  const popupHeight = 180;
  const win = new BrowserWindow({
    width: popupWidth,
    height: popupHeight,
    x: width - popupWidth - 24, // 既定 bottom-right(popup.position は設定 UI の change で反映)
    y: height - popupHeight - 24,
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
  win.setIgnoreMouseEvents(true); // 入力の邪魔をしない(打鍵中に前面へ出るため)
  void win.loadFile(POPUP_INDEX);
  return win;
}
