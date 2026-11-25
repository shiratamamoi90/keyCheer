// tray: システムトレイの薄いアダプタ。常駐アプリの最小 UI(表示 / 終了)。

import { Tray, Menu } from "electron";
import { APP_DISPLAY_NAME } from "../core/shared/appIdentity.js";
import { loadAppIcon } from "./appIcon.js";

// トレイのアイコンの大きさ(Windows の通知領域。高 DPI では OS が拡大する)
const TRAY_ICON_SIZE_PX = 16;

export interface TrayHandlers {
  onQuit: () => void;
  // 渡されたときだけ「開く」の項目とクリックでの表示を出す
  onShowMain?: (() => void) | undefined;
}

export function createTray(handlers: TrayHandlers): Tray {
  const tray = new Tray(loadAppIcon(TRAY_ICON_SIZE_PX));

  const menu = Menu.buildFromTemplate([
    ...(handlers.onShowMain
      ? [
          { label: `${APP_DISPLAY_NAME} を開く`, click: handlers.onShowMain },
          { type: "separator" as const },
        ]
      : []),
    { label: "終了", click: handlers.onQuit },
  ]);
  tray.setToolTip(APP_DISPLAY_NAME);
  tray.setContextMenu(menu);
  if (handlers.onShowMain) tray.on("click", handlers.onShowMain);
  return tray;
}
