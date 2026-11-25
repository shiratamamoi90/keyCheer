// core/shared/selectableSpeaker: 選べる話者(論点 0044)。決まった 4 つのスタイルの ID だけを選択肢・保存の対象にする。
// 要件: docs/character-creation.md「選べる話者」/ docs/licenses.md(クレジット表記。論点 0043)

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  SELECTABLE_SPEAKER_IDS,
  buildSpeakerCreditNotice,
  isSelectableSpeaker,
  resolveEditableSpeakerId,
} from "../../../src/core/shared/selectableSpeaker.js";

describe("selectableSpeaker / 選べる話者", () => {
  it("pins the four selectable styles fixed in docs", () => {
    expect([...SELECTABLE_SPEAKER_IDS]).toEqual([2, 8, 10, 11]);
    expect(isSelectableSpeaker(8)).toBe(true);
    expect(isSelectableSpeaker(3)).toBe(false);
  });
});

describe("selectableSpeaker / 編集で、今の話者が選べる話者に無ければ未選択として出す [境界]", () => {
  it("S0044_06 shows a speaker outside the selectable ones as not selected", () => {
    // GIVEN 保存済みのキャラクターの話者が、選べる話者以外の ID(3 = ずんだもん)
    // WHEN そのキャラクターの編集を開く
    const shown = resolveEditableSpeakerId(3);

    // THEN 話者は未選択として表示される(選べる話者ならそのまま)
    expect(shown).toBeNull();
    expect(resolveEditableSpeakerId(10)).toBe(10);
    expect(resolveEditableSpeakerId(null)).toBeNull();
  });
});

describe("selectableSpeaker / 話者を選ぶ画面に、その話者のクレジット表記を示す", () => {
  it("S0043_03 shows the credit of the chosen speaker and that outside use follows it and the speaker's terms", () => {
    const credits = [2, 8, 10, 11].map((id) => buildSpeakerCreditNotice(id));
    expect(credits[0]).toContain("VOICEVOX:四国めたん");
    expect(credits[1]).toContain("VOICEVOX:春日部つむぎ");
    expect(credits[2]).toContain("VOICEVOX:雨晴はう");
    expect(credits[3]).toContain("VOICEVOX:玄野武宏(CV:ガロ)");
    for (const text of credits) {
      expect(text).toContain("アプリの外で使うときは");
      expect(text).toContain("規約");
    }
    // 選んでいない・選べる話者でないときは何も出さない
    expect(buildSpeakerCreditNotice(null)).toBeNull();
    expect(buildSpeakerCreditNotice(3)).toBeNull();
  });
});

describe("selectableSpeaker / 表示は通信しない [否定]", () => {
  it("S0043_04 builds the credit from bundled text without any network access", () => {
    for (const file of [
      "src/core/shared/selectableSpeaker.ts",
      "src/renderer/characterScreen.tsx",
      "src/renderer/mainEntry.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|https?:\/\//);
    }
  });
});
