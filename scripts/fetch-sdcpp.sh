#!/usr/bin/env bash
# fetch-sdcpp: 同梱する sd.cpp(公式リリースの Windows 向け CPU 版)を取得する。論点 0040。
#
# 取得物はリポジトリに入れない(vendor/ は .gitignore 済み)。electron-builder が vendor/sdcpp を
# 配布物の resources/sdcpp に入れる(package.json の extraResources)。
# 版はタグと sha256 で固定する。上げるときは、タグ・ファイル名・sha256 の 3 つを同時に直し、
# 計測(decisions/decided/0041-image-base-model/config.yaml の sdcpp_tag)と揃える。
#
# 使い方: bash scripts/fetch-sdcpp.sh   (npm run package:win の前に 1 度だけ)

set -euo pipefail

SDCPP_TAG="master-1086-465adf3"
SDCPP_ZIP="sd-master-465adf3-bin-win-cpu-x64.zip" # CPU 版だけ。Vulkan・CUDA 向けは同梱しない(論点 0040 決定 1)
SDCPP_SHA256="6988bec67b291b2ad293cb1b69c71fb8793ae107a1c6a14699ab5570e1a7edef"
SDCPP_BIN="sd-cli.exe" # アプリが起動する実行ファイル(src/main/bundledSdcpp.ts と同じ名前)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/sdcpp"
DOWNLOAD="$ROOT/vendor/.download/$SDCPP_ZIP"

if [ -f "$DEST/$SDCPP_BIN" ] && [ -f "$DEST/.tag" ] && [ "$(cat "$DEST/.tag")" = "$SDCPP_TAG" ]; then
  echo "[fetch-sdcpp] 取得済み: $DEST ($SDCPP_TAG)"
  exit 0
fi

mkdir -p "$(dirname "$DOWNLOAD")"
echo "[fetch-sdcpp] 取得する: $SDCPP_ZIP ($SDCPP_TAG)"
curl -sSfL -o "$DOWNLOAD.part" \
  "https://github.com/leejet/stable-diffusion.cpp/releases/download/$SDCPP_TAG/$SDCPP_ZIP"
# 照合に通ったものだけを展開する(一致しなければ同梱しない。論点 0040 決定 2)
printf '%s  %s\n' "$SDCPP_SHA256" "$DOWNLOAD.part" | sha256sum -c --quiet -
mv -- "$DOWNLOAD.part" "$DOWNLOAD"

STAGE="$(mktemp -d "$ROOT/vendor/.stage.XXXXXX")"
unzip -q -o "$DOWNLOAD" -d "$STAGE"
if [ ! -f "$STAGE/$SDCPP_BIN" ]; then
  echo "[fetch-sdcpp] 配布物に $SDCPP_BIN が無い。配布物の形が変わった可能性がある" >&2
  exit 1
fi
mkdir -p "$DEST"
find "$DEST" -mindepth 1 -delete
cp -a "$STAGE"/. "$DEST"/
printf '%s' "$SDCPP_TAG" > "$DEST/.tag"
find "$STAGE" -mindepth 1 -delete && rmdir "$STAGE"
echo "[fetch-sdcpp] 完了: $DEST"
ls -la "$DEST"
