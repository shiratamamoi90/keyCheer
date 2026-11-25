// build-installer-license: インストーラの同意の画面に出す文書(installer/license.txt)を作る。論点 0043 / 0047 / 0060。
//
// 文面の組み立ては src/installer/installerLicense.ts(テストで縛っている)。ここは原文と npm の依存の一覧を読んで渡すだけ。
// npm build の後に動かす(dist/installer/installerLicense.js を読む)。npm run package:installer が呼ぶ。
// NSIS の Unicode 版が日本語を読めるよう、UTF-8 の BOM をつけて書く。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildInstallerLicenseText, LICENSE_TEXT_FILES } = await import(
  join(root, "dist/installer/installerLicense.js")
);

const texts = Object.fromEntries(
  Object.entries(LICENSE_TEXT_FILES).map(([id, file]) => [
    id,
    readFileSync(join(root, "assets/licenses", file), "utf8"),
  ]),
);

// 配布物に入る npm のパッケージ = lock の本番の依存から、package.json の build.files で外したものを除く
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const excluded = new Set(
  pkg.build.files
    .map((pattern) => /^!node_modules\/([^/]+)\/\*\*$/.exec(pattern)?.[1])
    .filter((name) => name !== undefined),
);
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const npmPackages = Object.entries(lock.packages)
  .filter(([path, info]) => path.startsWith("node_modules/") && !info.dev && !info.devOptional)
  .map(([path, info]) => ({
    name: path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
    version: info.version,
    license: info.license ?? "不明",
  }))
  .filter((entry) => !excluded.has(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name));

const out = join(root, "installer/license.txt");
writeFileSync(out, `﻿${buildInstallerLicenseText({ texts, npmPackages })}`, "utf8");
console.log(`[build-installer-license] ${out}(npm のパッケージ ${npmPackages.length} 個)`);
