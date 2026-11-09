// core/popupDisplayConfig: 常時表示の設定(popup.shouldAlwaysShow)の検証。
// 要件: docs/main-window.md「設定画面で常時表示を切り替える」/ docs/data-model.md(論点 0036)
// renderer からの変更は main 側で検証してから保存する(信頼境界。生成の設定と同じ扱い)。

import { describe, it, expect } from "vitest";
import { validatePopupDisplayConfig } from "../../src/core/popupDisplayConfig.js";

describe("popupDisplayConfig / renderer からの変更を検証する", () => {
  it("accepts only a boolean shouldAlwaysShow and drops unknown fields", () => {
    expect(validatePopupDisplayConfig({ shouldAlwaysShow: false, extra: 1 })).toEqual({
      ok: true,
      value: { shouldAlwaysShow: false },
    });
    expect(validatePopupDisplayConfig({ shouldAlwaysShow: "no" }).ok).toBe(false);
    expect(validatePopupDisplayConfig(null).ok).toBe(false);
    expect(validatePopupDisplayConfig([true]).ok).toBe(false);
  });
});
