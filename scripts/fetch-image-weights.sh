#!/usr/bin/env bash
# fetch-image-weights: 配布物の重みの別ファイルにする画像の重み(Counterfeit V3.0 と LCM LoRA)を取得する。論点 0041 / 0055。
#
# 取得するのは配布物を作る開発機だけ(利用者の機械は取得しない。インストーラが同じフォルダの別ファイルから置く)。
# 出所・コミット・sha256 は論点 0041 の決定の値(src/core/shared/imageWeights.ts と同じ)。名前は配布物の名前
# (src/core/shared/bundledWeights.ts の sourceName)にして release/weights/ に置く(release/ は .gitignore 済み)。
#
# 使い方: bash scripts/fetch-image-weights.sh [置き先のフォルダ(既定 release/weights)]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/release/weights}"
mkdir -p "$DEST"

# リポジトリ コミット 中のファイル 配布物の名前 sha256
WEIGHTS=(
  "gsdf/Counterfeit-V3.0 d8ce63b3eb8e9102e54b3fcc07f9cb7a28ef30fc Counterfeit-V3.0_fix_fp16.safetensors Counterfeit-V3.0_fix_fp16.safetensors a54c944e4c04e9d9ca43468ef5b90ea0408bb6264829a4980de79a768df7179f"
  "latent-consistency/lcm-lora-sdv1-5 cf2fced511dbe7e26c8d1d397e728fbab875db4b pytorch_lora_weights.safetensors lcm-lora-sdv1-5.safetensors 8f90d840e075ff588a58e22c6586e2ae9a6f7922996ee6649a7f01072333afe4"
)

for entry in "${WEIGHTS[@]}"; do
  read -r repo revision file name sha256 <<<"$entry"
  if [ -f "$DEST/$name" ] && printf '%s  %s\n' "$sha256" "$DEST/$name" | sha256sum -c --quiet - 2>/dev/null; then
    echo "[fetch-image-weights] 取得済み: $DEST/$name"
    continue
  fi
  echo "[fetch-image-weights] 取得する: $repo@$revision $file"
  curl -sSfL -o "$DEST/$name.part" "https://huggingface.co/$repo/resolve/$revision/$file"
  # 照合に通ったものだけを置く
  printf '%s  %s\n' "$sha256" "$DEST/$name.part" | sha256sum -c --quiet -
  mv -- "$DEST/$name.part" "$DEST/$name"
done
ls -la "$DEST"
