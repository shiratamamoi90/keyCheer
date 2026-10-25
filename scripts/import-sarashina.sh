#!/usr/bin/env bash
# import-sarashina: 開発用 Ollama に sarashina2.2-3b-instruct を取り込む(論点 0029)。
#
# 公式の重みをコミット固定で取得 → sha256 を照合 → compose の ollama コンテナで量子化して取り込む →
# 取得物を削除する。Ollama 公式ライブラリに無く、コミュニティの GGUF は出所を確かめられないため
# 自前で変換する(論点 0027)。モデル名・テンプレートは論点 0027 / 0028 の決定と一致させる。
#
# 使い方: npm run services:model(先に npm run services:up)
#   KEYCHEER_MODEL_CACHE … 取得先(既定 ~/.cache/keycheer-models)
#   KEYCHEER_OLLAMA_SERVICE … compose のサービス名(既定 ollama。GPU で動かしているなら ollama-gpu)

set -euo pipefail

REPO="sbintuitions/sarashina2.2-3b-instruct-v0.1"
REVISION="4f3626fb1b64b3e97c908e67f27b2d627ba2a999"
MODEL_NAME="sarashina2.2-3b-instruct" # system.ollamaModel の既定値(論点 0028)
QUANTIZE="q4_K_M"

# Hugging Face の LFS ハッシュ(上の REVISION のもの)。一致しなければ取り込まずに止める。
# 小さい設定ファイルは git の blob でハッシュが公開されないため、コミット固定の URL で取るに留める。
EXPECTED_SHA256="30c40f75b2282b08a597c6586074c64e180e9198ae93d831ab91b1e325b0444d  model-00001-of-00002.safetensors
af9747062f116fe6dee37526e7a4c7b1acfff48b85105bd143d1c6891cbe9f9a  model-00002-of-00002.safetensors
008293028e1a9d9a1038d9b63d989a2319797dfeaa03f171093a57b33a3a8277  tokenizer.model"

FILES=(
  config.json
  generation_config.json
  model.safetensors.index.json
  special_tokens_map.json
  tokenizer_config.json
  tokenizer.model
  model-00001-of-00002.safetensors
  model-00002-of-00002.safetensors
  LICENSE
)

CACHE_ROOT="${KEYCHEER_MODEL_CACHE:-$HOME/.cache/keycheer-models}"
SERVICE="${KEYCHEER_OLLAMA_SERVICE:-ollama}"
SRC_DIR="$CACHE_ROOT/sarashina2.2-3b-instruct-v0.1@$REVISION"
CONTAINER_DIR="/root/.ollama/import/sarashina-src"

cd "$(dirname "$0")/.."
container="$(docker compose --profile cpu --profile gpu ps -q "$SERVICE")"
if [ -z "$container" ]; then
  echo "[import-sarashina] $SERVICE が起動していない。先に npm run services:up" >&2
  exit 1
fi

cleanup() {
  # 成功・失敗どちらでも取得物とコンテナ内のコピーを残さない(論点 0029 決定 4)。
  # 親ディレクトリは空になったときだけ消す(rmdir は中身があれば失敗するので他の物を巻き込まない)
  docker exec "$container" rm -r -f -- "$CONTAINER_DIR" 2>/dev/null || true
  docker exec "$container" rmdir -- "$(dirname "$CONTAINER_DIR")" 2>/dev/null || true
  if [ -d "$SRC_DIR" ]; then rm -r -- "$SRC_DIR"; fi
  rmdir -- "$CACHE_ROOT" 2>/dev/null || true
}
trap cleanup EXIT

echo "[import-sarashina] $REPO@$REVISION を取得する(約 6.7 GB)"
mkdir -p "$SRC_DIR"
for f in "${FILES[@]}"; do
  curl -sSfL -o "$SRC_DIR/$f" "https://huggingface.co/$REPO/resolve/$REVISION/$f"
done

echo "[import-sarashina] sha256 を照合する"
(cd "$SRC_DIR" && printf '%s\n' "$EXPECTED_SHA256" | sha256sum -c --quiet -)

echo "[import-sarashina] $QUANTIZE に量子化して取り込む"
docker exec "$container" mkdir -p "$(dirname "$CONTAINER_DIR")"
docker cp "$SRC_DIR" "$container:$CONTAINER_DIR"
docker exec "$container" sh -c "cd '$CONTAINER_DIR' && printf 'FROM .\n' > Modelfile && ollama create '$MODEL_NAME' --quantize '$QUANTIZE' -f Modelfile"

# 取り込みだけではチャットテンプレートが当たらない(`{{ .Prompt }}` になる)ので、公式の
# tokenizer_config.json の形式を TEMPLATE に書いて作り直す(論点 0027「GGUF の出所の調査」)
docker exec "$container" sh -c "cat > '$CONTAINER_DIR/Modelfile.template' <<'MODELFILE'
FROM $MODEL_NAME
TEMPLATE \"\"\"{{ if .System }}<|system|>{{ .System }}</s>{{ end }}<|user|>{{ .Prompt }}</s><|assistant|>\"\"\"
PARAMETER stop \"</s>\"
PARAMETER stop \"<|user|>\"
MODELFILE
ollama create '$MODEL_NAME' -f '$CONTAINER_DIR/Modelfile.template'"

docker exec "$container" ollama show "$MODEL_NAME" --modelfile | grep -q '<|assistant|>' || {
  echo "[import-sarashina] TEMPLATE が当たっていない" >&2
  exit 1
}
# ollama create は取り込み元の safetensors と変換途中の層もモデル置き場に写し、量子化後もそのまま残す
# (約 13 GB)。Ollama はどこからも参照されない層を起動時に消すが、作られて 1 時間以内の層は残す
# (server/images.go の layerPruneGracePeriod)。直後の再起動では消えないので、ここでは消さずに案内だけする
echo "[import-sarashina] 取り込み元の層は 1 時間後以降の Ollama 起動時に自動で消える(npm run services:down → services:up)"

echo "[import-sarashina] 完了: $MODEL_NAME(取得物は削除する)"
