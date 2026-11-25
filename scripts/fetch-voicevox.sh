#!/usr/bin/env bash
# fetch-voicevox: 同梱する VOICEVOX ENGINE(公式リリースの Windows 向け CPU 版)を取得し、選べる話者の音声モデルだけを残す。論点 0034 / 0044。
#
# 取得物はリポジトリに入れない(vendor/ は .gitignore 済み)。electron-builder が vendor/voicevox を配布物の resources/voicevox に入れる。
# 版は compose の ENGINE と同じ(論点 0034 決定 1)。取るのは .vvpp(中身は zip。公式の sha256 つき)— 7z の分割版は展開に別の道具が要る。
# 音声モデルは選べる話者(src/core/shared/selectableSpeaker.ts のスタイル 2 / 8 / 10 / 11)が入っている 2 つだけを残す(論点 0044):
#   0.vvm = 四国めたん 2・春日部つむぎ 8・雨晴はう 10 / 4.vvm = 玄野武宏 11(各 vvm の metas.json で確かめた。2026-11-25)。
#   同じ版の Linux の ENGINE にこの 2 つだけを渡し、4 つのスタイルで音声を作れることを確かめた。選べる話者を変えたら、ここも直す。
#
# 使い方: bash scripts/fetch-voicevox.sh   (npm run package:win が先に呼ぶ)

set -euo pipefail

VOICEVOX_VERSION="0.25.2"
VOICEVOX_VVPP="voicevox_engine-windows-cpu-$VOICEVOX_VERSION.vvpp"
VOICEVOX_SHA256="cae07cb718866708d8c6148988769966168a2282610f53f002b19778ebea38e9"
VOICEVOX_BIN="run.exe" # アプリが起動する実行ファイル(src/main/bundledRuntime.ts と同じ名前)
KEPT_MODELS=("0.vvm" "4.vvm")

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/voicevox"
DOWNLOAD="$ROOT/vendor/.download/$VOICEVOX_VVPP"

if [ -f "$DEST/$VOICEVOX_BIN" ] && [ -f "$DEST/.tag" ] && [ "$(cat "$DEST/.tag")" = "$VOICEVOX_VERSION" ]; then
  echo "[fetch-voicevox] 取得済み: $DEST ($VOICEVOX_VERSION)"
  exit 0
fi

mkdir -p "$(dirname "$DOWNLOAD")"
if ! { [ -f "$DOWNLOAD" ] && printf '%s  %s\n' "$VOICEVOX_SHA256" "$DOWNLOAD" | sha256sum -c --quiet - 2>/dev/null; }; then
  echo "[fetch-voicevox] 取得する: $VOICEVOX_VVPP"
  curl -sSfL -o "$DOWNLOAD.part" "https://github.com/VOICEVOX/voicevox_engine/releases/download/$VOICEVOX_VERSION/$VOICEVOX_VVPP"
  printf '%s  %s\n' "$VOICEVOX_SHA256" "$DOWNLOAD.part" | sha256sum -c --quiet -
  mv -- "$DOWNLOAD.part" "$DOWNLOAD"
fi

STAGE="$(mktemp -d "$ROOT/vendor/.stage.XXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
unzip -q -o "$DOWNLOAD" -d "$STAGE"
if [ ! -f "$STAGE/$VOICEVOX_BIN" ]; then
  echo "[fetch-voicevox] 配布物に $VOICEVOX_BIN が無い。配布物の形が変わった可能性がある" >&2
  exit 1
fi
for model in "${KEPT_MODELS[@]}"; do
  if [ ! -f "$STAGE/model/$model" ]; then
    echo "[fetch-voicevox] 音声モデル $model が無い。配布物の形が変わった可能性がある" >&2
    exit 1
  fi
done
find "$STAGE/model" -maxdepth 1 -name '*.vvm' $(printf ' ! -name %s' "${KEPT_MODELS[@]}") -delete
printf '%s\n' "$VOICEVOX_VERSION" >"$STAGE/.tag"
rm -rf -- "$DEST"
mv -- "$STAGE" "$DEST"
trap - EXIT
echo "[fetch-voicevox] 完了: $DEST ($(du -sh "$DEST" | cut -f1))"
