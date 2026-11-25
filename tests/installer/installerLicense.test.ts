// installer/installerLicense: インストーラの同意の画面に出す文書(ライセンス・利用の制限・クレジット)。
// 要件: docs/licenses.md(論点 0043 / 0047 / 0060)。文書は同梱した原文から組み立てる。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInstallerLicenseText,
  LICENSE_TEXT_FILES,
  type LicenseTextId,
} from "../../src/installer/installerLicense.js";

const texts = Object.fromEntries(
  Object.entries(LICENSE_TEXT_FILES).map(([id, file]) => [
    id,
    readFileSync(`assets/licenses/${file}`, "utf8"),
  ]),
) as Record<LicenseTextId, string>;
const NPM = [
  { name: "react", version: "18.3.1", license: "MIT" },
  { name: "electron-store", version: "10.0.1", license: "MIT" },
];
const text = buildInstallerLicenseText({ texts, npmPackages: NPM });

describe("installerLicense / インストーラは重みを置く前に、ライセンスと利用の制限を示して同意を求める", () => {
  it("S0047_02 shows each image weight's name, source, license name, the full license and the use restrictions", () => {
    for (const expected of [
      "Counterfeit V3.0",
      "gsdf/Counterfeit-V3.0",
      "CreativeML Open RAIL-M",
      "LCM LoRA (SD1.5)",
      "latent-consistency/lcm-lora-sdv1-5",
      "CreativeML Open RAIL++-M",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain(texts["creativeml-open-rail-m"].trim());
    expect(text).toContain(texts["creativeml-open-rail-pp-m"].trim());
    expect(text).toContain("Use Restrictions");
  });
});

describe("installerLicense / インストーラはライセンスとクレジットを示す", () => {
  it("S0060_01 covers every bundled item, the four speaker credits and their terms URLs", () => {
    for (const expected of [
      "VOICEVOX ENGINE",
      "LGPL v3",
      "https://github.com/VOICEVOX/voicevox_engine/tree/0.25.2",
      texts["lgpl-3.0"].trim(),
      "VOICEVOX:四国めたん",
      "https://zunko.jp/con_ongen_kiyaku.html",
      "VOICEVOX:春日部つむぎ",
      "https://tsumugi-official.studio.site/rule",
      "VOICEVOX:雨晴はう",
      "https://amehau.com/?page_id=225",
      "VOICEVOX:玄野武宏(CV:ガロ)",
      "https://www.virvoxproject.com/voicevoxの利用規約",
      texts["ollama-mit"].trim(),
      texts["stable-diffusion-cpp-mit"].trim(),
      texts["sarashina2.2-mit"].trim(),
      "ONNX Runtime",
      texts["u2-net-apache-2.0"].trim(),
      "react 18.3.1 (MIT)",
      "electron-store 10.0.1 (MIT)",
    ]) {
      expect(text, expected.slice(0, 40)).toContain(expected);
    }
  });
});
