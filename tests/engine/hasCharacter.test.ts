// engine/hasCharacter: キャラクター「作成済み」判定の純粋関数。
// spec: changes/0008-main-window-character-creation/spec.md
//       「キャラクター未作成なら起動時にメインウィンドウを表示する」
//       「hasCharacter は必須フィールドの充足で判定する [境界]」

import { describe, it, expect } from "vitest";
import { hasCharacter } from "../../src/engine/hasCharacter.js";
import type { Character } from "../../src/shared/types.js";

const COMPLETE: Character = {
  id: "char-test",
  name: "チア",
  personality: "元気いっぱい",
  imagePaths: { normal: "n.png" },
  voicevoxSpeakerId: 3,
  generatedBy: { text: "local-ollama", voice: "local-voicevox", image: "local-sdcpp" },
};

describe("engine/hasCharacter / hasCharacter は必須フィールドの充足で判定する [境界]", () => {
  it("returns false when character is undefined", () => {
    expect(hasCharacter(undefined)).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(hasCharacter({})).toBe(false);
  });

  it("returns false when required fields are empty/missing", () => {
    expect(hasCharacter({ name: "", personality: "" })).toBe(false);
  });

  it("returns false when only name is present", () => {
    expect(hasCharacter({ name: "チア" })).toBe(false);
  });

  it("returns true when all required fields are satisfied", () => {
    expect(hasCharacter(COMPLETE)).toBe(true);
  });
});

// spec: changes/0010-character-creation-local/spec.md
// 0010 で「作成済み」の定義をプロフィール(名前・性格・話者)のみに変更した。
// 画像生成は別 change のため、画像が無くても作成完了できる必要がある。
// これを許さないと画像を作るまで永久に「未作成」となり、起動のたびに
// メインウィンドウが自動表示されてしまう(0008 の自動表示ロジックへの波及)。
describe("engine/hasCharacter / プロフィールが揃っていれば作成済みとする", () => {
  it("returns true for name + personality + voicevoxSpeakerId alone", () => {
    expect(hasCharacter({ name: "チア", personality: "元気いっぱい", voicevoxSpeakerId: 3 })).toBe(
      true,
    );
  });
});

describe("engine/hasCharacter / 画像が無くても作成済みと判定する [境界]", () => {
  it("returns true when imagePaths is missing entirely", () => {
    expect(hasCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 })).toBe(true);
  });

  it("returns true when imagePaths is an empty object", () => {
    expect(
      hasCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3, imagePaths: {} }),
    ).toBe(true);
  });
});

describe("engine/hasCharacter / プロフィールが欠けていれば未作成とする [境界]", () => {
  it("returns false when personality is empty", () => {
    expect(hasCharacter({ name: "チア", personality: "", voicevoxSpeakerId: 3 })).toBe(false);
  });

  it("returns false when name is empty", () => {
    expect(hasCharacter({ name: "", personality: "元気", voicevoxSpeakerId: 3 })).toBe(false);
  });

  it("returns false when voicevoxSpeakerId is missing", () => {
    expect(hasCharacter({ name: "チア", personality: "元気" })).toBe(false);
  });
});
