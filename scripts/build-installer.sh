#!/usr/bin/env bash
# build-installer: ビルド専用コンテナ(論点 0031)で Windows 向けのインストーラ(NSIS)を作る。
#
# イメージは electron-builder 公式の wine つき(タグ + digest で固定。論点 0031 決定 4)。ホストの node_modules と
# dist/・vendor/・installer/license.txt をそのまま使う(先に npm run build・fetch:runtimes・build-installer-license.mjs)。
# Electron と NSIS の取得物はホストのキャッシュを共有して、毎回取り直さない。
# 出力は release/TypeYell-Setup-<版>.exe。配布するときは、これと release/weights/ の重みの別ファイルを同じフォルダに並べる(論点 0055)。
#
# 使い方: npm run package:installer

set -euo pipefail

IMAGE="electronuserland/builder:wine@sha256:f3a8d451994c881d0972e7b1846ee4d4fdc15eb41fc6b1f350b38cbf99ca90fe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
# wine は HOME が自分の持ち物でないと設定のフォルダを作らない(コンテナの /tmp は root の持ち物)
BUILDER_HOME="$CACHE/keycheer-builder-home"
mkdir -p "$CACHE/electron" "$CACHE/electron-builder" "$BUILDER_HOME"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/builder-home \
  -e ELECTRON_CACHE=/cache/electron \
  -e ELECTRON_BUILDER_CACHE=/cache/electron-builder \
  -v "$ROOT":/project \
  -v "$CACHE/electron":/cache/electron \
  -v "$CACHE/electron-builder":/cache/electron-builder \
  -v "$BUILDER_HOME":/builder-home \
  -w /project \
  "$IMAGE" \
  npx electron-builder --win nsis
ls -la "$ROOT"/release/TypeYell-Setup-*.exe
