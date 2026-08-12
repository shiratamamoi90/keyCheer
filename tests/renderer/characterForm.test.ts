// renderer/characterForm: キャラ作成フォームのビューモデル(純粋関数)。
// spec: 論点 0019
// DOM 操作は I/O グルーでテスト対象外。検証と値の組み立てだけをここで縛る。

import { describe, it, expect } from "vitest";
import {
  validateCharacterForm,
  toCharacterProfile,
  CHARACTER_NAME_MAX,
  CHARACTER_PERSONALITY_MAX,
  type CharacterFormInput,
} from "../../src/renderer/characterForm.js";

const VALID: CharacterFormInput = {
  name: "チア",
  personality: "元気いっぱいで前向き",
  speakerId: 3,
};

describe("characterForm / 必須項目が揃うまで保存できない", () => {
  it("S0019_01 rejects an empty name", () => {
    const result = validateCharacterForm({ ...VALID, name: "" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ field: "name", reason: "required" });
  });

  it("rejects an empty personality", () => {
    const result = validateCharacterForm({ ...VALID, personality: "" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ field: "personality", reason: "required" });
  });

  it("accepts a fully filled form", () => {
    expect(validateCharacterForm(VALID)).toEqual({ ok: true, errors: [] });
  });

  it("reports every missing field at once (どの項目が不足しているか示す)", () => {
    const result = validateCharacterForm({ name: "", personality: "", speakerId: null });
    expect(result.errors).toHaveLength(3);
  });
});

describe("characterForm / 名前と性格の長さ制約 [境界]", () => {
  it("S0019_02 accepts a name exactly at the limit", () => {
    const name = "あ".repeat(CHARACTER_NAME_MAX);
    expect(validateCharacterForm({ ...VALID, name }).ok).toBe(true);
  });

  it("rejects a name one character over the limit", () => {
    const name = "あ".repeat(CHARACTER_NAME_MAX + 1);
    const result = validateCharacterForm({ ...VALID, name });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ field: "name", reason: "too-long" });
  });

  it("rejects a personality one character over the limit", () => {
    const personality = "あ".repeat(CHARACTER_PERSONALITY_MAX + 1);
    const result = validateCharacterForm({ ...VALID, personality });
    expect(result.errors).toContainEqual({ field: "personality", reason: "too-long" });
  });

  it("counts by code point so surrogate pairs do not break the limit", () => {
    // 絵文字は UTF-16 では 2 単位だがコードポイントでは 1
    const name = "😀".repeat(CHARACTER_NAME_MAX);
    expect(name.length).toBe(CHARACTER_NAME_MAX * 2); // UTF-16 の length は倍
    expect(validateCharacterForm({ ...VALID, name }).ok).toBe(true);
  });
});

describe("characterForm / 前後の空白は無視する [境界]", () => {
  it("S0019_03 treats whitespace-only input as missing", () => {
    const result = validateCharacterForm({ ...VALID, name: "   " });
    expect(result.errors).toContainEqual({ field: "name", reason: "required" });
  });

  it("measures the length after trimming", () => {
    const name = `  ${"あ".repeat(CHARACTER_NAME_MAX)}  `;
    expect(validateCharacterForm({ ...VALID, name }).ok).toBe(true);
  });

  it("trims the stored values", () => {
    const profile = toCharacterProfile({ ...VALID, name: "  チア  ", personality: "  元気  " });
    expect(profile.name).toBe("チア");
    expect(profile.personality).toBe("元気");
  });
});

describe("characterForm / 話者を選ばないと保存できない", () => {
  it("S0019_04 rejects a null speakerId", () => {
    const result = validateCharacterForm({ ...VALID, speakerId: null });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ field: "speakerId", reason: "required" });
  });

  it("puts the chosen speaker into the profile", () => {
    expect(toCharacterProfile({ ...VALID, speakerId: 7 }).voicevoxSpeakerId).toBe(7);
  });
});

describe("characterForm / ビューモデルは純粋", () => {
  it("does not mutate the input", () => {
    const input: CharacterFormInput = { ...VALID };
    const snapshot = { ...input };
    validateCharacterForm(input);
    toCharacterProfile(input);
    expect(input).toEqual(snapshot);
  });
});
