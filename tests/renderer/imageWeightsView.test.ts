// renderer/imageWeightsView: 設定画面の、画像の重みの取得とライセンスの表示の文言(純粋関数)。
// 要件: docs/model-weights.md(論点 0042)/ docs/licenses.md(論点 0047)

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  buildImageWeightLines,
  buildImageWeightsLicenseSections,
  buildUseRestrictionText,
  formatByteSize,
  imageWeightsFailureText,
  imageWeightsStatusLabel,
} from "../../src/renderer/imageWeightsView.js";

// 同梱したライセンスの本文(原文のまま)。アプリでは main が読んで画面へ渡す
const TEXTS = {
  "base-model": readFileSync("assets/licenses/creativeml-open-rail-m.txt", "utf8"),
  "lcm-lora": readFileSync("assets/licenses/creativeml-open-rail-pp-m.txt", "utf8"),
};

describe("imageWeightsView / 設定画面のライセンスの表示で、画像の重みのライセンスと利用の制限が読める", () => {
  it("S0047_01 lists the name, the source, the license name and the full text for both weights, plus the use restrictions", () => {
    // GIVEN 画像の重みを取得していない(表示は重みの状態を受け取らない)
    // WHEN 設定画面でライセンスの表示を開く
    const sections = buildImageWeightsLicenseSections(TEXTS);
    const restrictions = buildUseRestrictionText(TEXTS);

    // THEN Counterfeit V3.0 と LCM LoRA それぞれの名前・配布元・ライセンス名・ライセンスの全文と、利用の制限が読める
    expect(sections.map((s) => [s.name, s.source, s.licenseName])).toEqual([
      [
        "Counterfeit V3.0",
        "https://huggingface.co/gsdf/Counterfeit-V3.0",
        "CreativeML Open RAIL-M",
      ],
      [
        "LCM LoRA (SD1.5)",
        "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5",
        "CreativeML Open RAIL++-M",
      ],
    ]);
    expect(sections[0]!.text).toContain("CreativeML Open RAIL-M");
    expect(sections[0]!.text).toContain("END OF TERMS AND CONDITIONS");
    expect(sections[1]!.text).toContain("CreativeML Open RAIL++-M License");
    expect(sections[1]!.text).toContain("END OF TERMS AND CONDITIONS");
    expect(restrictions).toContain("You agree not to use the Model or Derivatives of the Model");
    expect(restrictions).toContain("To provide medical advice and medical results interpretation");
  });
});

describe("imageWeightsView / 取得の前に示すもの・進捗・失敗の文言", () => {
  it("shows the name, the size and the source of each weight", () => {
    expect(buildImageWeightLines()).toEqual([
      "Counterfeit V3.0(2.0 GB)取得元: https://huggingface.co/gsdf/Counterfeit-V3.0",
      "LCM LoRA (SD1.5)(128 MB)取得元: https://huggingface.co/latent-consistency/lcm-lora-sdv1-5",
    ]);
  });

  it("formats byte sizes in MB and GB", () => {
    expect(formatByteSize(134_621_556)).toBe("128 MB");
    expect(formatByteSize(2_132_651_162)).toBe("2.0 GB");
  });

  it("labels the status", () => {
    const base = { hasWeights: false, canFetch: true, needsLicenseAgreement: true, progress: null };
    expect(imageWeightsStatusLabel(base)).toBe("未取得");
    expect(imageWeightsStatusLabel({ ...base, hasWeights: true, canFetch: false })).toBe(
      "取得済み",
    );
    expect(
      imageWeightsStatusLabel({
        ...base,
        canFetch: false,
        progress: { doneBytes: 1_066_325_581, totalBytes: 2_267_272_718 },
      }),
    ).toBe("取得中… 1017 MB / 2.1 GB");
  });

  it("explains each failure and says that the fetch can be resumed", () => {
    expect(imageWeightsFailureText("cancelled")).toBe(
      "取得を中断しました。もう一度始めると続きから取得します",
    );
    expect(imageWeightsFailureText("network")).toContain("続きから");
    expect(imageWeightsFailureText("hash-mismatch")).toContain("取り直して");
    expect(imageWeightsFailureText("insufficient-space")).toContain("空き容量");
    expect(imageWeightsFailureText("license-agreement-required")).toContain("同意");
  });
});
