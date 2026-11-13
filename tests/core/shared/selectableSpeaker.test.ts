// core/shared/selectableSpeaker: 選べる話者(論点 0044)。決まった 4 つのスタイルの ID だけを選択肢・保存の対象にする。
// 要件: docs/character-creation.md「選べる話者」

import { describe, it, expect } from "vitest";
import {
  SELECTABLE_SPEAKER_IDS,
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
