// engine/hasCharacter: キャラクター「作成済み」判定の純粋関数。
// spec: changes/0008-main-window-character-creation/spec.md
//       「キャラクター未作成なら起動時にメインウィンドウを表示する」
//       「hasCharacter は必須フィールドの充足で判定する [境界]」

import { describe, it, expect } from "vitest";
import { hasCharacter } from "../../src/engine/hasCharacter.js";
import type { Character } from "../../src/shared/types.js";

const COMPLETE: Character = {
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
