// shared/theme: テーマ(ui.theme)からメインウィンドウの見た目を決める(論点 0057)。
// spec: docs/main-window.md S0057_01 / S0057_04
// 純粋関数。main(読み込み時の検証)と renderer(当てる側)の両方が使うので shared に置く。OS の設定は引数で受ける。

import { THEME_SETTINGS, type ThemeSetting } from "./types.js";

export type ResolvedTheme = "light" | "dark";

const THEME_SETTING_SET = new Set<string>(THEME_SETTINGS);

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === "string" && THEME_SETTING_SET.has(value);
}

// S0057_01 system なら OS の設定に合わせる / S0057_04 light / dark なら OS に従わない
export function resolveTheme(setting: ThemeSetting, isOsDark: boolean): ResolvedTheme {
  if (setting === "system") return isOsDark ? "dark" : "light";
  return setting;
}
