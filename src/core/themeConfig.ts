// themeConfig: テーマ(ui.theme)の保存前の検証(論点 0057)。
// spec: docs/main-window.md S0057_06
// 純粋関数。main が renderer からの値を保存する前に呼ぶ(信頼境界。security-rules.md)。

import { isThemeSetting } from "./shared/theme.js";
import { THEME_SETTINGS } from "./shared/types.js";

// S0057_06 テーマの不正な値は保存しない
export function validateThemeSetting(value: unknown): string[] {
  return isThemeSetting(value) ? [] : [`theme must be one of ${THEME_SETTINGS.join(" / ")}`];
}
