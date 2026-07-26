// main/characterInput: renderer から届いた保存リクエストの検証。
// spec: specs/character-creation.md「renderer からの入力は main 側でも検証する [不変条件]」
// フォーム側(characterForm)の検証は UX のためのもので、main 側の検証を省く理由にはならない
// (security-rules.md「入力と信頼境界」)。electron に依存しないため決定的にテストできる。

import { describe, it, expect } from "vitest";
import { validateCharacterProfile } from "../../src/main/characterInput.js";

describe("characterInput / renderer からの入力は main 側でも検証する [不変条件]", () => {
  it("accepts a well-formed profile", () => {
    const result = validateCharacterProfile({
      name: "チア",
      personality: "元気いっぱい",
      voicevoxSpeakerId: 3,
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "チア", personality: "元気いっぱい", voicevoxSpeakerId: 3 },
    });
  });

  it("rejects a payload that is not an object", () => {
    for (const raw of [undefined, null, "チア", 42, []]) {
      expect(validateCharacterProfile(raw).ok).toBe(false);
    }
  });

  it("rejects non-string name / personality even if present", () => {
    expect(validateCharacterProfile({ name: 1, personality: "p", voicevoxSpeakerId: 3 }).ok).toBe(
      false,
    );
    expect(validateCharacterProfile({ name: "n", personality: {}, voicevoxSpeakerId: 3 }).ok).toBe(
      false,
    );
  });

  it("rejects a whitespace-only name (フォームを迂回されても通さない)", () => {
    expect(
      validateCharacterProfile({ name: "   ", personality: "p", voicevoxSpeakerId: 3 }).ok,
    ).toBe(false);
  });

  it("rejects a non-integer speaker id", () => {
    for (const id of [undefined, null, "3", 3.5, Number.NaN]) {
      expect(
        validateCharacterProfile({ name: "n", personality: "p", voicevoxSpeakerId: id }).ok,
      ).toBe(false);
    }
  });

  it("trims before storing", () => {
    const result = validateCharacterProfile({
      name: "  チア  ",
      personality: "  元気  ",
      voicevoxSpeakerId: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 });
  });

  it("reports every problem at once", () => {
    const result = validateCharacterProfile({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  it("ignores extra fields (プールや画像パスを注入させない)", () => {
    const result = validateCharacterProfile({
      name: "チア",
      personality: "元気",
      voicevoxSpeakerId: 3,
      imagePaths: { normal: "/etc/passwd" },
      pool: { buckets: {} },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["name", "personality", "voicevoxSpeakerId"]);
  });
});
