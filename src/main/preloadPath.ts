// preloadPath: BrowserWindow に渡す preload スクリプトの絶対パス。
// ウィンドウを作る側(windows.ts / mainWindow.ts)が同じ値を参照するため、ここを正本にする。
//
// なぜ両者に直書きしないか:拡張子 `.mjs` は scripts/postbuild.mjs が付け替えた結果であって、
// tsc の出力そのものではない。ビルド側の付け替えを変えたときに直す箇所を 1 つに保つ
// (片方だけ直すと、そのウィンドウだけ preload を読めずに API が生えない)。

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ビルド出力(dist/)基準。dist/main/ から見た相対位置。
export const PRELOAD_PATH = join(__dirname, "../preload/index.mjs");
