import { describe, it, expect } from "vitest";
import { resolveWavPath, planCheerPlayback } from "../../src/agent/cheerPlayer.js";
import type { CheerSelection } from "../../src/core/cheerSelector.js";

// 要件: docs/data-model.md「音声ファイル」(messageId → wav パスは決定的に解決可能)
//       docs/cheer-trigger.md「音声ファイル欠損時のフォールバック」「キャラ未作成時の発動」
// 再生(音を出す)は main 側。ここは再生計画(何を表示し、どの wav を鳴らすか)まで。

function selection(overrides: Partial<CheerSelection> = {}): CheerSelection {
  return {
    messageId: "fast_regular_evening-003",
    text: "その調子!",
    bucketKey: "fast_regular_evening",
    sourceBucketKey: "fast_regular_evening",
    source: "pool",
    ...overrides,
  };
}

describe("cheerPlayer / 音声ファイルのパス解決", () => {
  it("resolves {userData}/characters/{characterId}/voices/{messageId}.wav deterministically", () => {
    const path = resolveWavPath("/appdata/keyCheer", "chia-2026", "fast_regular_evening-003");
    expect(path).toBe("/appdata/keyCheer/characters/chia-2026/voices/fast_regular_evening-003.wav");
  });
});

describe("cheerPlayer / プールからの 1 文選択 + 対応 wav 再生", () => {
  it("plans popup text + wav path when the wav exists", () => {
    const plan = planCheerPlayback({
      selection: selection(),
      userDataDir: "/appdata/keyCheer",
      characterId: "chia",
      wavExists: () => true,
    });
    expect(plan.popupText).toBe("その調子!");
    expect(plan.wavPath).toBe(
      "/appdata/keyCheer/characters/chia/voices/fast_regular_evening-003.wav",
    );
  });
});

describe("cheerPlayer / 音声ファイル欠損時のフォールバック [異常系]", () => {
  it("S0013_10 falls back to text-only popup when the wav file is missing", () => {
    const plan = planCheerPlayback({
      selection: selection(),
      userDataDir: "/appdata/keyCheer",
      characterId: "chia",
      wavExists: () => false, // 生成失敗などで欠損
    });
    expect(plan.popupText).toBe("その調子!"); // テキストは表示する
    expect(plan.wavPath).toBeNull(); // 音声なし(クラッシュしない)
  });
});

describe("cheerPlayer / キャラ未作成時(baseline)の発動", () => {
  it("baseline selections are always text-only (no wav was pre-synthesized)", () => {
    const plan = planCheerPlayback({
      selection: selection({
        messageId: "baseline:normal_regular_morning:0",
        text: "今日も良いペースだね!",
        source: "baseline",
      }),
      userDataDir: "/appdata/keyCheer",
      characterId: "chia",
      wavExists: () => true, // exists が何を返そうと baseline は wav なし
    });
    expect(plan.popupText).toBe("今日も良いペースだね!");
    expect(plan.wavPath).toBeNull();
  });
});
