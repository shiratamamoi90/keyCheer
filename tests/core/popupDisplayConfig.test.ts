// core/popupDisplayConfig: 常時表示の設定(popup.shouldAlwaysShow)の検証。
// 要件: docs/main-window.md「設定画面で常時表示を切り替える」/ docs/data-model.md(論点 0036)
// renderer からの変更は main 側で検証してから保存する(信頼境界。生成の設定と同じ扱い)。

import { describe, it, expect } from "vitest";
import { validatePopupDisplayConfig } from "../../src/core/popupDisplayConfig.js";

describe("popupDisplayConfig / renderer からの変更を検証する", () => {
  it("accepts only a boolean shouldAlwaysShow and drops unknown fields", () => {
    expect(
      validatePopupDisplayConfig({ shouldAlwaysShow: false, shouldShowMessage: true, extra: 1 }),
    ).toEqual({
      ok: true,
      value: { shouldAlwaysShow: false, shouldShowMessage: true },
    });
    expect(validatePopupDisplayConfig({ shouldAlwaysShow: "no", shouldShowMessage: true }).ok).toBe(
      false,
    );
    expect(validatePopupDisplayConfig(null).ok).toBe(false);
    expect(validatePopupDisplayConfig([true]).ok).toBe(false);
  });
});

describe("popupDisplayConfig / セリフを出すかの不正な値は保存しない [不変条件]", () => {
  it("S0053_09 rejects a non-boolean shouldShowMessage", () => {
    // GIVEN renderer から shouldShowMessage に真偽値でない値が届く
    // WHEN main が受け取る(保存の前に検証する)
    // THEN エラーを返す(保存しない)
    for (const shouldShowMessage of ["no", 0, null, undefined]) {
      const result = validatePopupDisplayConfig({ shouldAlwaysShow: true, shouldShowMessage });
      expect(result.ok).toBe(false);
    }
    expect(
      validatePopupDisplayConfig({ shouldAlwaysShow: true, shouldShowMessage: false }),
    ).toEqual({ ok: true, value: { shouldAlwaysShow: true, shouldShowMessage: false } });
  });
});
