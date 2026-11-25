#!/usr/bin/env bash
# extract-text-model: 配布するテキストモデルの GGUF を、開発機の Ollama の取り込みから取り出す。論点 0074。
#
# `npm run services:model` で取り込んだ sarashina2.2-3b-instruct の q4_K_M の層は、中身が GGUF そのもの。
# それをコンテナの外へコピーし、論点 0059 の名前にして、配布物の重みの別ファイルにする(release/ は .gitignore 済み)。
# sha256 は論点 0030 の 2 回の取り込みが出した層に固定し(src/core/shared/textModel.ts と同じ値)、一致しなければ置かない。
#
# 使い方: bash scripts/extract-text-model.sh [置き先のフォルダ(既定 release/weights)]
#   開発機でアプリの生成を試すときは、置き先に {userData}/weights/text を渡す(Linux なら ~/.config/keycheer/weights/text)。

set -euo pipefail

LAYER_SHA256="60e33bab403b69d923fef2bbbaf798adf1ba47cd897dfdf815bf85f433b6b959"
MODEL_FILE="sarashina2.2-3b-instruct-q4_K_M.gguf" # src/core/shared/textModel.ts と同じ名前
BLOB_PATH="/root/.ollama/models/blobs/sha256-$LAYER_SHA256" # compose の ollama の置き場(Ollama 0.32.13)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/release/weights}"

if [ -f "$DEST/$MODEL_FILE" ] && printf '%s  %s\n' "$LAYER_SHA256" "$DEST/$MODEL_FILE" | sha256sum -c --quiet - 2>/dev/null; then
  echo "[extract-text-model] 取り出し済み: $DEST/$MODEL_FILE"
  exit 0
fi

container="$(docker compose -f "$ROOT/compose.yaml" ps -q ollama)"
if [ -z "$container" ]; then
  echo "[extract-text-model] ollama コンテナが動いていない(npm run services:up → npm run services:model)" >&2
  exit 1
fi

mkdir -p "$DEST"
echo "[extract-text-model] 層を取り出す: sha256-$LAYER_SHA256"
docker cp "$container:$BLOB_PATH" "$DEST/$MODEL_FILE.part"
# 照合に通ったものだけを置く(取り込み直して層が変わっていたら止める)
printf '%s  %s\n' "$LAYER_SHA256" "$DEST/$MODEL_FILE.part" | sha256sum -c --quiet -
mv -- "$DEST/$MODEL_FILE.part" "$DEST/$MODEL_FILE"
echo "[extract-text-model] 完了: $DEST/$MODEL_FILE"
