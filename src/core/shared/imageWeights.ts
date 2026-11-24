// imageWeights: 画像の重み(local-sdcpp が使うベースモデルと LCM LoRA)の定義。
// 要件: docs/model-weights.md(出所の表)。論点 0041 / 0055
//
// 出所・版・sha256 は論点 0041 の決定の値(decisions/decided/0041-image-base-model/config.yaml)。
// 重みは配布物に入れ、インストーラが置く(論点 0055)。アプリは取得しない(S0055_07)。
// 置き場の名前は、同梱した sd.cpp が読む名前と同じものを 1 箇所で持つ(main/bundledSdcpp.ts が参照する)。
// 置き場の名前はインストーラ(論点 0055)とも揃える定義なので shared に置く。発動経路からは使わない。
// ライセンスはアプリの中に出さない(論点 0060)。名前・配布元・ライセンス名はインストーラが示すための記録。

export interface ImageWeightFile {
  id: "base-model" | "lcm-lora";
  displayName: string;
  repository: string; // 配布元(Hugging Face のリポジトリ)
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
