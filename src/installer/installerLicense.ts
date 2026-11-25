// installerLicense: インストーラの同意の画面に出す文書を組み立てる(ビルドのときだけ使う。アプリの中には出さない。論点 0060)。
// 要件: docs/licenses.md S0047_02・S0060_01(論点 0043 / 0047 / 0060)
//
// 文面は同梱した原文(assets/licenses/)から作り、通信しない(S0047_10)。画像の重みの名前・配布元・ライセンス名は
// 重みの定義(core/shared/imageWeights.ts)から取り、写し直さない。話者の規約の URL は VOICEVOX ENGINE 0.25.2 の
// 配布物の規約文(resources/character_info/*/policy.md)にあるもの。**配布の前に人間が各原文を読んで確かめる**(論点 0043 決定 9)。

import { IMAGE_WEIGHT_FILES } from "../core/shared/imageWeights.js";

export const LICENSE_TEXT_FILES = {
  "creativeml-open-rail-m": "creativeml-open-rail-m.txt",
  "creativeml-open-rail-pp-m": "creativeml-open-rail-pp-m.txt",
  "lgpl-3.0": "lgpl-3.0.txt",
  "voicevox-engine": "voicevox-engine.txt",
  "ollama-mit": "ollama-mit.txt",
  "stable-diffusion-cpp-mit": "stable-diffusion-cpp-mit.txt",
  "sarashina2.2-mit": "sarashina2.2-mit.txt",
  "onnxruntime-mit": "onnxruntime-mit.txt",
  "u2-net-apache-2.0": "u2-net-apache-2.0.txt",
} as const;

export type LicenseTextId = keyof typeof LICENSE_TEXT_FILES;

// 画像の重みのライセンスの原文(ライセンス名 → 原文の id)
const IMAGE_LICENSE_TEXT: Record<string, LicenseTextId> = {
  "CreativeML Open RAIL-M": "creativeml-open-rail-m",
  "CreativeML Open RAIL++-M": "creativeml-open-rail-pp-m",
};

// 選べる話者のクレジット表記(docs/licenses.md)と規約の URL(ENGINE の配布物の規約文)
const SPEAKER_TERMS: readonly { credit: string; url: string }[] = [
  { credit: "VOICEVOX:四国めたん", url: "https://zunko.jp/con_ongen_kiyaku.html" },
  { credit: "VOICEVOX:春日部つむぎ", url: "https://tsumugi-official.studio.site/rule" },
  { credit: "VOICEVOX:雨晴はう", url: "https://amehau.com/?page_id=225" },
  {
    credit: "VOICEVOX:玄野武宏(CV:ガロ)",
    url: "https://www.virvoxproject.com/voicevoxの利用規約",
  },
];

const VOICEVOX_ENGINE_SOURCE = "https://github.com/VOICEVOX/voicevox_engine/tree/0.25.2";
const RULE = "=".repeat(72);

export interface NpmPackageLicense {
  name: string;
  version: string;
  license: string;
}

export function buildInstallerLicenseText(input: {
  texts: Record<LicenseTextId, string>;
  npmPackages: readonly NpmPackageLicense[];
}): string {
  const section = (title: string, ...body: string[]): string =>
    [RULE, title, RULE, "", ...body, ""].join("\n");
  const full = (id: LicenseTextId): string => input.texts[id].trim();

  // S0047_02 画像の重み:名前・配布元・ライセンス名・ライセンスの全文・利用の制限(全文の Attachment A)
  const imageWeights = section(
    "1. 画像の重み(同意が要ります)",
    "次の画像の重みは、ライセンスが利用者にも「利用の制限」(各ライセンスの Attachment A「Use Restrictions」)を守ることを求めています。",
    "インストールを進めると、このライセンスと利用の制限に同意したことになります。同意しない場合はインストールを中止してください。",
    "",
    ...IMAGE_WEIGHT_FILES.flatMap((file) => [
      `- ${file.displayName}`,
      `  配布元: https://huggingface.co/${file.repository}(コミット ${file.revision})`,
      `  ライセンス: ${file.licenseName}`,
    ]),
    "",
    ...IMAGE_WEIGHT_FILES.flatMap((file) => [
      `--- ${file.displayName}: ${file.licenseName} ---`,
      "",
      full(IMAGE_LICENSE_TEXT[file.licenseName]!),
      "",
    ]),
  );

  // S0060_01 そのほかの同梱物とクレジット
  const voicevox = section(
    "2. VOICEVOX ENGINE",
    "VOICEVOX ENGINE 0.25.2 を LGPL v3 で使っています。同梱した版のソースコード:",
    VOICEVOX_ENGINE_SOURCE,
    "",
    full("voicevox-engine"),
    "",
    full("lgpl-3.0"),
  );
  const voices = section(
    "3. VOICEVOX の音声(クレジット表記)",
    "生成した音声をアプリの外で使うときは、次のクレジット表記を載せ、各話者の利用規約に従ってください。",
    "",
    ...SPEAKER_TERMS.flatMap((speaker) => [`- ${speaker.credit}`, `  利用規約: ${speaker.url}`]),
  );
  const runtimes = section(
    "4. Ollama / stable-diffusion.cpp / テキストモデル(sarashina2.2-3b-instruct)",
    "--- Ollama ---",
    "",
    full("ollama-mit"),
    "",
    "--- stable-diffusion.cpp ---",
    "",
    full("stable-diffusion-cpp-mit"),
    "",
    "--- sarashina2.2-3b-instruct(SB Intuitions)---",
    "",
    full("sarashina2.2-mit"),
  );
  const segmentation = section(
    "5. ONNX Runtime / 人物を切り抜くモデル(u2netp)",
    "--- ONNX Runtime(onnxruntime-node 1.31.1)---",
    "",
    full("onnxruntime-mit"),
    "",
    "--- U-2-Net(u2netp)---",
    "",
    full("u2-net-apache-2.0"),
  );
  const npm = section(
    "6. アプリが使う npm のパッケージ",
    ...input.npmPackages.map((pkg) => `${pkg.name} ${pkg.version} (${pkg.license})`),
  );

  return [imageWeights, voicevox, voices, runtimes, segmentation, npm].join("\n");
}
