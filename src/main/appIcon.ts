// appIcon: アプリのアイコン(人間が作る 1 枚の正方形の PNG。論点 0077)を窓とトレイに使う。
// 画像が無ければ空の画像を返し、Electron の既定のアイコンのままにする(画像が届くまでの間)。

import { nativeImage, type NativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/main から見たリポジトリ直下(配布物では app.asar の直下)の assets/icon.png
const APP_ICON_PATH = join(__dirname, "../../assets/icon.png");

export function loadAppIcon(sizePx?: number): NativeImage {
  const image = nativeImage.createFromPath(APP_ICON_PATH);
  if (image.isEmpty() || sizePx === undefined) return image;
  return image.resize({ width: sizePx, height: sizePx, quality: "best" });
}
