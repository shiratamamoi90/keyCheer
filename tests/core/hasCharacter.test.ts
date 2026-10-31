// core/hasCharacter: キャラクター「作成済み」判定の純粋関数。
// 要件: docs/data-model.md「`hasCharacter` の判定」(論点 0032)
//
// 論点 0032 で「プロフィールが揃っていれば作成済み」から「characters が 1 件以上」に変わった。
// 各キャラクターは保存時に検証済みなので件数だけを見る。使用中のキャラクターやプールの有無は
// 判定に含めない(含めると生成が済むまで起動のたびにメインウィンドウが自動表示される)。

import { describe, it, expect } from "vitest";
import { hasCharacter } from "../../src/core/hasCharacter.js";
import type { Character } from "../../src/core/shared/types.js";

const SAVED: Character = {
  id: "char-test",
  name: "チア",
  personality: "元気いっぱい",
  imagePaths: {},
  voicevoxSpeakerId: 3,
};

describe("core/hasCharacter / 1 件以上あれば作成済み", () => {
  it("S0032_29 returns true for one saved character without a pool or an active character", () => {
    const characters = [SAVED];

    expect(hasCharacter(characters)).toBe(true);
  });
});

describe("core/hasCharacter / 0 件なら未作成 [境界]", () => {
  it("S0032_30 returns false for an empty list and for a missing list", () => {
    expect(hasCharacter([])).toBe(false);
    expect(hasCharacter(undefined)).toBe(false);
  });
});
