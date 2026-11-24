#!/usr/bin/env bash
# fetch-u2netp: 同梱する人物を切り抜くモデル(u2netp)を取得する。論点 0063 / 0066。
#
# 取得物はリポジトリに入れない(vendor/ は .gitignore 済み)。electron-builder が vendor/u2netp を
# 配布物の resources/u2netp に入れる(package.json の extraResources)。開発時はアプリが vendor/u2netp を読む。
# 版は sha256 で固定する(論点 0066 の決定。計測で使った scripts/fetch-seg-eval.sh と同じもの)。
#
# 使い方: bash scripts/fetch-u2netp.sh   (npm run package:win が先に呼ぶ)

set -euo pipefail

MODEL_URL="https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
MODEL_SHA256="309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
MODEL_FILE="u2netp.onnx" # src/main/bundledSegmentation.ts と同じ名前

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/u2netp"

if [ -f "$DEST/$MODEL_FILE" ] && printf '%s  %s\n' "$MODEL_SHA256" "$DEST/$MODEL_FILE" | sha256sum -c --quiet - 2>/dev/null; then
  echo "[fetch-u2netp] 取得済み: $DEST/$MODEL_FILE"
  exit 0
fi

mkdir -p "$DEST"
echo "[fetch-u2netp] 取得する: $MODEL_URL"
curl -sSfL -o "$DEST/$MODEL_FILE.part" "$MODEL_URL"
# 照合に通ったものだけを置く(一致しなければ同梱しない)
printf '%s  %s\n' "$MODEL_SHA256" "$DEST/$MODEL_FILE.part" | sha256sum -c --quiet -
mv -- "$DEST/$MODEL_FILE.part" "$DEST/$MODEL_FILE"
echo "[fetch-u2netp] 完了: $DEST/$MODEL_FILE"
