// core/generatedBy: 生成元プロバイダーの記録(種別ごとのマージと定義域の検査)。
// 要件: docs/integrations.md「生成元の記録」/ docs/data-model.md(論点 0022)
// 「選んだ」ではなく「実際に作った」プロバイダーだけを残す。種別ごとに独立して更新する。

import { describe, it, expect } from "vitest";
import { applyGeneratedBy, validateGeneratedBy } from "../../src/core/generatedBy.js";

describe("generatedBy / 種別ごとの記録が他の種別を壊さない [否定]", () => {
  it("S0022_05 recording voice leaves the recorded text unchanged", () => {
    const current = { text: "openai" as const };

    const next = applyGeneratedBy(current, { voice: "elevenlabs" });

    expect(next.text).toBe("openai");
    expect(next.voice).toBe("elevenlabs");
    // 純関数:引数を書き換えない
    expect(current).toEqual({ text: "openai" });
  });
});

describe("generatedBy / 再生成で生成元が更新される", () => {
  it("S0022_06 regenerating voice with another provider replaces the recorded voice", () => {
    const next = applyGeneratedBy(
      { text: "local-ollama", voice: "local-voicevox" },
      { voice: "elevenlabs" },
    );

    expect(next).toEqual({ text: "local-ollama", voice: "elevenlabs" });
  });
});

describe("generatedBy / 値はプロバイダー識別子の定義域に従う [境界]", () => {
  it("S0022_10 rejects an out-of-domain id but allows unset kinds", () => {
    expect(validateGeneratedBy({ text: "gpt-unknown" })).not.toEqual([]);
    // 種別をまたいだ識別子も定義域外(voice に text の ID は入らない)
    expect(validateGeneratedBy({ voice: "local-ollama" })).not.toEqual([]);
    // 未設定は許す
    expect(validateGeneratedBy({})).toEqual([]);
    expect(validateGeneratedBy({ text: "anthropic", voice: "openai-tts" })).toEqual([]);
  });
});
