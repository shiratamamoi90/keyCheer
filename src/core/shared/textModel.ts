// textModel: 配布物に入れるテキストモデル(sarashina2.2-3b-instruct の q4_K_M の GGUF)の定義。
// 要件: docs/model-weights.md(論点 0055 / 0059 / 0073 / 0074)
//
// 値は論点 0059 の config.yaml(decisions/decided/0059-text-model-bundle-form/config.yaml)。sha256 は開発機の取り込みが出した
// q4_K_M の層(論点 0030 / 0074)。インストーラの補助モード(論点 0072)と、生成のたびの照合(S0059)が同じ定義を読む。
// 発動経路からは使わない(S0055_10)。

// {userData} の下の、テキストモデルの置き場
export const TEXT_WEIGHTS_DIR = "weights/text";

export const TEXT_MODEL_FILE = {
  file: "sarashina2.2-3b-instruct-q4_K_M.gguf",
  sha256: "60e33bab403b69d923fef2bbbaf798adf1ba47cd897dfdf815bf85f433b6b959",
  byteSize: 2_066_389_248,
} as const;
