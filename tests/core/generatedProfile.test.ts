// core/generatedProfile: 生成後にプロフィールを変えたかの判定(純粋関数)。
// 要件: docs/pool-generation.md「複数のキャラクターがあるときの生成」(論点 0032)
// 生成時のプロフィールは pool.json の generatedProfile(docs/data-model.md「メッセージプール」)。

import { describe, it, expect } from "vitest";
import { hasProfileChangedSinceGeneration } from "../../src/core/generatedProfile.js";

const GENERATED = { name: "チア", personality: "元気いっぱい", voicevoxSpeakerId: 3 };

describe("core/generatedProfile / 生成後にプロフィールを変えたことが分かる", () => {
  it("S0032_22 detects a change in name, personality or speaker and not after reverting", () => {
    expect(hasProfileChangedSinceGeneration({ ...GENERATED, name: "ミズ" }, GENERATED)).toBe(true);
    expect(
      hasProfileChangedSinceGeneration({ ...GENERATED, personality: "落ち着いている" }, GENERATED),
    ).toBe(true);
    expect(
      hasProfileChangedSinceGeneration({ ...GENERATED, voicevoxSpeakerId: 8 }, GENERATED),
    ).toBe(true);
    // 元の値に戻したら判定しない
    expect(hasProfileChangedSinceGeneration({ ...GENERATED }, GENERATED)).toBe(false);
  });
});

describe("core/generatedProfile / 生成時のプロフィールを持たないプールは「変えた」と判定しない [境界]", () => {
  it("S0032_23 returns false when the pool has no generatedProfile", () => {
    expect(hasProfileChangedSinceGeneration({ ...GENERATED, name: "ミズ" }, undefined)).toBe(false);
  });
});
