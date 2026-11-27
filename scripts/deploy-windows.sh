#!/usr/bin/env bash
# deploy-windows: WSL2 で作った Windows 用の展開済みフォルダを、Windows 側へ置く(論点 0025)。
#
# 置き場は KEYCHEER_WIN_DEPLOY_DIR で上書きできる。未設定なら Windows の「ドキュメント」の下の keyCheer。
# 手元固有の絶対パスを追跡ファイルに書かないため、既定は実行時に Windows から問い合わせて作る
# (論点 0023 細目 4 と同じ理由)。%USERPROFILE%\Documents を組み立てないのは、
# OneDrive にリダイレクトされていると実際の場所と食い違うため。
#
# 古いファイルは消さずに上書きする。置き場を環境変数で差し替えられる以上、削除を伴う同期にすると
# 指定を誤ったときに無関係なフォルダを消しうる。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT/release/win-unpacked"   # electron-builder --win --dir の出力(package.json の build.directories)
DEPLOY_FOLDER_NAME="keyCheer"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "deploy-windows: $SOURCE_DIR が無い。先に npm run package:win を実行する" >&2
  exit 1
fi

if [ -n "${KEYCHEER_WIN_DEPLOY_DIR:-}" ]; then
  dest="$KEYCHEER_WIN_DEPLOY_DIR"
else
  if ! command -v powershell.exe >/dev/null || ! command -v wslpath >/dev/null; then
    echo "deploy-windows: WSL2 から Windows に問い合わせできない。KEYCHEER_WIN_DEPLOY_DIR で置き場を指定する" >&2
    exit 1
  fi
  documents_win="$(powershell.exe -NoProfile -NonInteractive -Command "[Environment]::GetFolderPath('MyDocuments')" | tr -d '\r')"
  if [ -z "$documents_win" ]; then
    echo "deploy-windows: Windows の「ドキュメント」を解決できない。KEYCHEER_WIN_DEPLOY_DIR で置き場を指定する" >&2
    exit 1
  fi
  dest="$(wslpath -u "$documents_win")/$DEPLOY_FOLDER_NAME"
fi

mkdir -p "$dest"
# Windows 側でアプリが起動したままだと .exe / .dll が掴まれていてコピーに失敗する
if ! cp -r "$SOURCE_DIR"/. "$dest"/; then
  echo "deploy-windows: コピーに失敗した。Windows 側でアプリが起動したままなら終了してから再実行する" >&2
  exit 1
fi

echo "deploy-windows: $dest に置いた"
if command -v wslpath >/dev/null; then
  # exe の名前は electron-builder が package.json の productName から付ける(論点 0077 で TypeYell にした)。
  # 名前を直書きすると、見える名前を変えたときに案内だけ古い名前のまま残る
  product_name="$(node -p "require('$ROOT/package.json').productName")"
  echo "  Windows からは $(wslpath -w "$dest")\\$product_name.exe を実行する"
fi
