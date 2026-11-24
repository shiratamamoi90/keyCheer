// core/themeConfig: テーマ(ui.theme)の保存前の検証。
// 要件: docs/main-window.md(論点 0057)

import { describe, expect, it } from "vitest";
import { validateThemeSetting } from "../../src/core/themeConfig.js";

describe("themeConfig / テーマの不正な値は保存しない [不変条件]", () => {
  it("S0057_06 rejects values other than system, light and dark", () => {
    for (const ok of ["system", "light", "dark"]) expect(validateThemeSetting(ok), ok).toEqual([]);
    for (const bad of ["Dark", "auto", "", null, undefined, 1, {}, ["dark"]]) {
      expect(validateThemeSetting(bad), String(bad)).not.toEqual([]);
    }
  });
});
