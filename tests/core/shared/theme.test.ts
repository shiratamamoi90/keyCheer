// core/shared/theme: テーマからメインウィンドウの見た目(ライト / ダーク)を決める。
// 要件: docs/main-window.md(論点 0057)

import { describe, expect, it } from "vitest";
import { resolveTheme } from "../../../src/core/shared/theme.js";

describe("theme / テーマが system なら OS の設定に合わせる", () => {
  it("S0057_01 follows the OS when the theme is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("theme / light / dark を選んでいれば OS の設定に従わない [境界]", () => {
  it("S0057_04 keeps light or dark whatever the OS says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
