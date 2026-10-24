// core/textResponse: テキスト応答のパース契約(記号を落とす → 空要素を捨てる → N 件 → 30 字)。
// spec: 論点 0024 / docs/integrations.md「テキスト応答のパース契約」
// 純粋関数なので、応答の messages 配列を直接渡して結果だけを見る。

import { describe, it, expect } from "vitest";
import { buildMessageTexts, validateTextResponse } from "../../src/core/textResponse.js";

// 打ち切りが効かない十分大きな件数(件数の規則を見ないシナリオで使う)
const NO_LIMIT = 100;

describe("textResponse / テキスト応答のパース契約", () => {
  it("S0024_04 returns each array element as one sentence without re-splitting", () => {
    expect(buildMessageTexts(["がんばれ!", "いい調子!"], NO_LIMIT)).toEqual([
      "がんばれ!",
      "いい調子!",
    ]);
  });

  it("S0024_05 strips emphasis markers anywhere in the element", () => {
    expect(
      buildMessageTexts(["**頑張れ!**", "__いいね__", "ここが**大事**だよ"], NO_LIMIT),
    ).toEqual(["頑張れ!", "いいね", "ここが大事だよ"]);
  });

  it("S0024_06 strips leading heading markers, numbering and bullets", () => {
    expect(
      buildMessageTexts(["## 応援だよ", "1. 頑張れ", "- ファイト", "・いけるよ"], NO_LIMIT),
    ).toEqual(["応援だよ", "頑張れ", "ファイト", "いけるよ"]);
  });

  it("S0024_07 strips a trailing parenthesized annotation", () => {
    expect(
      buildMessageTexts(["頑張れ!(normal)", "いい調子 (fast)", "ゆっくりね(slow)"], NO_LIMIT),
    ).toEqual(["頑張れ!", "いい調子", "ゆっくりね"]);
  });

  it("S0024_08 strips markers before applying the 30-character limit", () => {
    const body = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ"; // 30 文字
    expect(buildMessageTexts([`**${body}**`], NO_LIMIT)).toEqual([body]);
  });

  it("S0024_09 does not count elements that become empty after stripping", () => {
    expect(buildMessageTexts(["**", "がんばれ!", "(normal)", "いいね!"], 2)).toEqual([
      "がんばれ!",
      "いいね!",
    ]);
  });

  it("S0024_11 keeps markers that appear inside the sentence", () => {
    expect(
      buildMessageTexts(["No.1を目指そう#勝利", "100%(全力)で行こう!", "3*3=9だね"], NO_LIMIT),
    ).toEqual(["No.1を目指そう#勝利", "100%(全力)で行こう!", "3*3=9だね"]);
  });

  it("S0024_13 does not modify the received array or its elements", () => {
    const messages = ["**頑張れ!**", "", "1. いいね(normal)"];
    const before = [...messages];

    const texts = buildMessageTexts(messages, NO_LIMIT);

    expect(messages).toEqual(before);
    expect(texts).not.toBe(messages);
  });
});

// 形式違反の検出部分。バケットの failed への落とし方は poolGenerator 側で縛る。
describe("textResponse / 応答の形式を検証する", () => {
  it("accepts an object whose messages is an array of strings", () => {
    expect(validateTextResponse({ messages: ["がんばれ!"] })).toEqual([]);
  });

  it.each([
    ["not an object", "がんばれ!"],
    ["null", null],
    ["missing messages", {}],
    ["messages is not an array", { messages: "がんばれ!" }],
    ["an element is not a string", { messages: ["がんばれ!", 1] }],
  ])("reports %s", (_label, raw) => {
    expect(validateTextResponse(raw).length).toBeGreaterThan(0);
  });
});
