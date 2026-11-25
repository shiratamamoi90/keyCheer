#!/usr/bin/env bash
# fetch-ollama: 同梱する Ollama(公式リリースの Windows 向け)を取得し、CPU で動くものだけを置く。論点 0034。
#
# 取得物はリポジトリに入れない(vendor/ は .gitignore 済み)。electron-builder が vendor/ollama を配布物の resources/ollama に入れる。
# 版は compose の Ollama と同じ(論点 0034 決定 1)。上げるときは版・sha256 を同時に直す(sha256 は公式リリースの sha256sum.txt と同じ値)。
# 公式の zip には GPU 向け(cuda_v12 / cuda_v13 / vulkan)も入っているが、同梱は CPU だけなので外す(約 1.9 GB → 約 80 MB)。
#
# 使い方: bash scripts/fetch-ollama.sh   (npm run package:win が先に呼ぶ)

set -euo pipefail

OLLAMA_VERSION="v0.32.13"
OLLAMA_ZIP="ollama-windows-amd64.zip"
OLLAMA_SHA256="20d61a8075038694f5b6db1e937551dbc79d470e85217003facf6ecaac394258"
OLLAMA_BIN="ollama.exe" # アプリが起動する実行ファイル(src/main/bundledRuntime.ts と同じ名前)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/ollama"
DOWNLOAD="$ROOT/vendor/.download/$OLLAMA_ZIP"

if [ -f "$DEST/$OLLAMA_BIN" ] && [ -f "$DEST/.tag" ] && [ "$(cat "$DEST/.tag")" = "$OLLAMA_VERSION" ]; then
  echo "[fetch-ollama] 取得済み: $DEST ($OLLAMA_VERSION)"
  exit 0
fi

mkdir -p "$(dirname "$DOWNLOAD")"
if ! { [ -f "$DOWNLOAD" ] && printf '%s  %s\n' "$OLLAMA_SHA256" "$DOWNLOAD" | sha256sum -c --quiet - 2>/dev/null; }; then
  echo "[fetch-ollama] 取得する: $OLLAMA_ZIP ($OLLAMA_VERSION)"
  curl -sSfL -o "$DOWNLOAD.part" "https://github.com/ollama/ollama/releases/download/$OLLAMA_VERSION/$OLLAMA_ZIP"
  # 照合に通ったものだけを展開する(一致しなければ同梱しない。論点 0034 決定 1)
  printf '%s  %s\n' "$OLLAMA_SHA256" "$DOWNLOAD.part" | sha256sum -c --quiet -
  mv -- "$DOWNLOAD.part" "$DOWNLOAD"
fi

STAGE="$(mktemp -d "$ROOT/vendor/.stage.XXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
# GPU 向けのフォルダは展開しない(CPU 版だけを同梱する)
unzip -q -o "$DOWNLOAD" -d "$STAGE" -x 'lib/ollama/cuda_*/*' 'lib/ollama/vulkan/*'
if [ ! -f "$STAGE/$OLLAMA_BIN" ]; then
  echo "[fetch-ollama] 配布物に $OLLAMA_BIN が無い。配布物の形が変わった可能性がある" >&2
  exit 1
fi
printf '%s\n' "$OLLAMA_VERSION" >"$STAGE/.tag"
rm -rf -- "$DEST"
mv -- "$STAGE" "$DEST"
trap - EXIT
echo "[fetch-ollama] 完了: $DEST ($(du -sh "$DEST" | cut -f1))"
