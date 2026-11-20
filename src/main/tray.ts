// tray: システムトレイの薄いアダプタ。常駐アプリの最小 UI(表示 / 終了)。
// アイコン画像の配置はビルド設定確定後に紐付ける(下記 TODO)。

import { Tray, Menu, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TrayHandlers {
  onQuit: () => void;
  // 渡されたときだけ「開く」の項目とクリックでの表示を出す
  onShowMain?: (() => void) | undefined;
}

export function createTray(handlers: TrayHandlers): Tray {
  // TODO(ビルド): 同梱アイコン(assets/tray.png)確定後に差し替える。
  const iconPath = join(__dirname, "../../assets/tray.png");
  const image = nativeImage.createFromPath(iconPath);
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);

  const menu = Menu.buildFromTemplate([
    ...(handlers.onShowMain
      ? [{ label: "KeyCheer を開く", click: handlers.onShowMain }, { type: "separator" as const }]
      : []),
    { label: "終了", click: handlers.onQuit },
  ]);
  tray.setToolTip("KeyCheer");
  tray.setContextMenu(menu);
  if (handlers.onShowMain) tray.on("click", handlers.onShowMain);
  return tray;
}
