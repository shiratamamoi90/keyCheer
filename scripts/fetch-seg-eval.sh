#!/usr/bin/env bash
# 論点 0063 の計測だけで使う、人物を切り抜くモデル(u2netp)と ONNX の実行ライブラリを、リポジトリの外に取る。
# アプリの依存には入れない(採るかは論点で決める)。版と sha256 で固定する。
# 置き場は KEYCHEER_SEG_EVAL_DIR(既定 ~/.cache/keycheer-models/seg-eval)。
set -euo pipefail

DIR="${KEYCHEER_SEG_EVAL_DIR:-$HOME/.cache/keycheer-models/seg-eval}"
ORT_VERSION="1.31.1"
MODEL_URL="https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
MODEL_SHA256="309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"

mkdir -p "$DIR"
if [ ! -f "$DIR/u2netp.onnx" ]; then
  curl -fsSL -o "$DIR/u2netp.onnx.part" "$MODEL_URL"
  mv "$DIR/u2netp.onnx.part" "$DIR/u2netp.onnx"
fi
echo "$MODEL_SHA256  $DIR/u2netp.onnx" | sha256sum -c -

# 配布物に入っている実行ファイルだけを使う(インストール時のスクリプトは動かさない)
npm install --prefix "$DIR" --no-save --ignore-scripts --no-audit --no-fund "onnxruntime-node@$ORT_VERSION"
