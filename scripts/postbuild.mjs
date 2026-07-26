// postbuild: tsc の出力(dist/)を Electron が読める形に整える。バンドラは使わない。
// spec: changes/0007-runnable-popup-slice/spec.md「開発起動・ビルドができる」(確定事項 #1)
//
// やること:
//   1. renderer の静的ファイル(*.html)を dist/renderer/ へコピーする
//   2. preload を `.mjs` にする — package.json が type:module のため、Electron に ESM preload と
//      認識させるには拡張子が .mjs である必要がある(windows.ts はこのパスを参照している)
//   3. preload 内の相対 import(./api.js 等)も .mjs へ付け替える

import { cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

async function copyRendererAssets() {
  const from = join(root, "src", "renderer");
  const to = join(dist, "renderer");
  for (const entry of await readdir(from)) {
    if (entry.endsWith(".html") || entry.endsWith(".css")) {
      await cp(join(from, entry), join(to, entry));
    }
  }
}

// main.html の React プレースホルダーが読む UMD ビルド。バンドラを使わない制約上、
// node_modules から dist/renderer/vendor へそのままコピーする(changes/0008)。
async function copyReactVendor() {
  const vendor = join(dist, "renderer", "vendor");
  await mkdir(vendor, { recursive: true });
  const files = [
    ["react", "umd/react.production.min.js"],
    ["react-dom", "umd/react-dom.production.min.js"],
  ];
  for (const [pkg, rel] of files) {
    const from = join(root, "node_modules", pkg, rel);
    if (!existsSync(from)) continue;
    await cp(from, join(vendor, rel.split("/").pop()));
  }
}

async function toMjs() {
  const preloadDir = join(dist, "preload");
  if (!existsSync(preloadDir)) return;
  const files = (await readdir(preloadDir)).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const path = join(preloadDir, file);
    // preload 内部の相対 import を .mjs に付け替える(../shared/* は ESM の .js のままで読める)
    const source = await readFile(path, "utf8");
    await writeFile(path, source.replace(/from "\.\/([\w./-]+)\.js"/g, 'from "./$1.mjs"'), "utf8");
    await rename(path, path.replace(/\.js$/, ".mjs"));
  }
}

await copyRendererAssets();
await copyReactVendor();
await toMjs();
console.log("postbuild: renderer assets copied, preload emitted as .mjs");
