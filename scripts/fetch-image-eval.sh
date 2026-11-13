#!/usr/bin/env bash
# fetch-image-eval: 画像のベースモデルの計測(論点 0041)に使う sd.cpp と重みを開発機に取得する。
#
# 公式の配布物を版固定で取得 → sha256 を照合する。一致しなければ止める(論点 0029 / 0040 と同じやり方)。
# 取得物は計測のあいだ使い続けるので、import-sarashina.sh と違って自動では消さない。
# 要らなくなったら置き場(下の IMAGE_EVAL_DIR)を手で消す。
#
# 使い方: bash scripts/fetch-image-eval.sh
#   KEYCHEER_MODEL_CACHE … 取得先(既定 ~/.cache/keycheer-models)。計測ドライバも同じ変数で置き場を引く
#
# ここの値(タグ・コミット・ファイル名・sha256)は decisions/**/0041-image-base-model/config.yaml に
# 記録した計測条件と一致させる。片方だけ直さない。

set -euo pipefail

# --- sd.cpp(開発機は Linux 向け CPU 版。論点 0040 決定 1・5)---
SDCPP_TAG="master-1086-465adf3"
SDCPP_ZIP="sd-master-465adf3-bin-Linux-Ubuntu-26.04-x86_64.zip"
SDCPP_SHA256="7503e04904c55d02ad5835982ea3ec77f6d97c1fec60f23421b78e916675618a"

# --- 重み(Hugging Face の公式のリポジトリ。コミット固定)---
# 置き先の名前 | リポジトリ | コミット | ファイル(URL エンコード済み)| sha256
WEIGHTS=(
  "counterfeit-v3.safetensors|gsdf/Counterfeit-V3.0|d8ce63b3eb8e9102e54b3fcc07f9cb7a28ef30fc|Counterfeit-V3.0_fix_fp16.safetensors|a54c944e4c04e9d9ca43468ef5b90ea0408bb6264829a4980de79a768df7179f"
  "meinamix-v10.safetensors|Meina/MeinaMix|ff1db1369784ead73c86d91c7d2b2d66fc5e7361|Meina%20V10%20-%20baked%20VAE.safetensors|77b7dc4ef0fca64ed8c3c38e80efa3e559488ee377f4138ec4bce488ef6c8412"
  "lora/lcm-lora-sdv1-5.safetensors|latent-consistency/lcm-lora-sdv1-5|cf2fced511dbe7e26c8d1d397e728fbab875db4b|pytorch_lora_weights.safetensors|8f90d840e075ff588a58e22c6586e2ae9a6f7922996ee6649a7f01072333afe4"
)

CACHE_ROOT="${KEYCHEER_MODEL_CACHE:-$HOME/.cache/keycheer-models}"
IMAGE_EVAL_DIR="$CACHE_ROOT/image-eval"
SDCPP_DIR="$IMAGE_EVAL_DIR/sdcpp-$SDCPP_TAG"
MODEL_DIR="$IMAGE_EVAL_DIR/models"
IMAGE_EVAL_IMAGE="keycheer-image-eval:$SDCPP_TAG" # 計測ドライバ(src/eval)が同じ名前で起動する

# 照合に通ったファイルだけを最終の名前に置く(途中で切れた取得物を次回「取得済み」と誤認しない)
fetch_verified() {
  local url="$1" dest="$2" sha="$3"
  if [ -f "$dest" ] && printf '%s  %s\n' "$sha" "$dest" | sha256sum -c --quiet - 2>/dev/null; then
    echo "[fetch-image-eval] 取得済み: $dest"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  echo "[fetch-image-eval] 取得する: $url"
  curl -sSfL -C - -o "$dest.part" "$url"
  printf '%s  %s\n' "$sha" "$dest.part" | sha256sum -c --quiet -
  mv -- "$dest.part" "$dest"
}

fetch_verified \
  "https://github.com/leejet/stable-diffusion.cpp/releases/download/$SDCPP_TAG/$SDCPP_ZIP" \
  "$IMAGE_EVAL_DIR/$SDCPP_ZIP" "$SDCPP_SHA256"
if [ ! -d "$SDCPP_DIR" ]; then
  mkdir -p "$SDCPP_DIR"
  unzip -q -o "$IMAGE_EVAL_DIR/$SDCPP_ZIP" -d "$SDCPP_DIR"
fi

for entry in "${WEIGHTS[@]}"; do
  IFS='|' read -r name repo revision file sha <<<"$entry"
  fetch_verified "https://huggingface.co/$repo/resolve/$revision/$file" "$MODEL_DIR/$name" "$sha"
done

# sd.cpp を動かすコンテナ(開発機の GLIBC では配布物が動かないため。理由は image-eval.Dockerfile)
docker build -q -t "$IMAGE_EVAL_IMAGE" -f "$(dirname "$0")/image-eval.Dockerfile" "$(dirname "$0")" >/dev/null
echo "[fetch-image-eval] コンテナ: $IMAGE_EVAL_IMAGE"

echo "[fetch-image-eval] 完了: $IMAGE_EVAL_DIR"
