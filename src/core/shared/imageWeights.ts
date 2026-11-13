// imageWeights: 画像の重み(local-sdcpp が使うベースモデルと LCM LoRA)の定義と、ライセンスへの同意の判定。
// 要件: docs/model-weights.md(取得元の表・S0042)/ docs/licenses.md(S0047)。論点 0041 / 0042 / 0047
//
// 取得元・版・sha256 は論点 0041 の決定の値(decisions/decided/0041-image-base-model/config.yaml)。
// 置き場の名前は、同梱した sd.cpp が読む名前と同じものを 1 箇所で持つ(main/bundledSdcpp.ts が参照する)。
// main(取得)と renderer(表示)の両方が使うので shared に置く。発動経路からは使わない。

export interface ImageWeightFile {
  id: "base-model" | "lcm-lora";
  displayName: string;
  repository: string; // Hugging Face のリポジトリ
  revision: string; // コミット(版を固定する)
  file: string; // リポジトリの中のファイル名
  relativePath: string; // 重みの置き場の中の置き先
  sha256: string;
  byteSize: number;
  licenseName: string;
}

// {userData} の下の、画像の重みの置き場
export const IMAGE_WEIGHTS_DIR = "weights/image";

export const IMAGE_WEIGHT_FILES: readonly ImageWeightFile[] = [
  {
    id: "base-model",
    displayName: "Counterfeit V3.0",
    repository: "gsdf/Counterfeit-V3.0",
    revision: "d8ce63b3eb8e9102e54b3fcc07f9cb7a28ef30fc",
    file: "Counterfeit-V3.0_fix_fp16.safetensors",
    relativePath: "Counterfeit-V3.0_fix_fp16.safetensors",
    sha256: "a54c944e4c04e9d9ca43468ef5b90ea0408bb6264829a4980de79a768df7179f",
    byteSize: 2_132_651_162,
    licenseName: "CreativeML Open RAIL-M",
  },
  {
    id: "lcm-lora",
    displayName: "LCM LoRA (SD1.5)",
    repository: "latent-consistency/lcm-lora-sdv1-5",
    revision: "cf2fced511dbe7e26c8d1d397e728fbab875db4b",
    file: "pytorch_lora_weights.safetensors",
    // sd.cpp はプロンプトの <lora:lcm-lora-sdv1-5:1> の名前でファイルを探すので、配布物の名前から変えて置く
    relativePath: "lora/lcm-lora-sdv1-5.safetensors",
    sha256: "8f90d840e075ff588a58e22c6586e2ae9a6f7922996ee6649a7f01072333afe4",
    byteSize: 134_621_556,
    licenseName: "CreativeML Open RAIL++-M",
  },
];

const WEIGHT_HOST = "https://huggingface.co";

// 取得元の URL。公式のリポジトリから直接取得し、自分たちではホストしない(論点 0041)
export function buildImageWeightUrl(file: ImageWeightFile): string {
  return `${WEIGHT_HOST}/${file.repository}/resolve/${file.revision}/${encodeURIComponent(file.file)}`;
}

// 表示用の取得元(S0042_02 / S0048_02 取得の前に取得元を示す)
export function buildImageWeightSource(file: ImageWeightFile): string {
  return `${WEIGHT_HOST}/${file.repository}`;
}

// S0047_08 同意した対象の版。取得する重みかライセンスを変えたら上げる(S0047_09 同意を取り直す)
export const IMAGE_WEIGHTS_LICENSE_VERSION = "1";

export interface ImageWeightsLicenseAgreement {
  agreedAt: string; // ISO 8601
  version: string;
}

// S0047_07 同意済みの人にはもう一度求めない / S0047_09 取得する重みかライセンスが変わったら同意を取り直す
// 保存データは手で書き換えられうるので、形が違うものは同意していないものとして扱う。
export function hasLicenseAgreement(record: unknown): record is ImageWeightsLicenseAgreement {
  if (typeof record !== "object" || record === null) return false;
  const { agreedAt, version } = record as Record<string, unknown>;
  return typeof agreedAt === "string" && version === IMAGE_WEIGHTS_LICENSE_VERSION;
}
