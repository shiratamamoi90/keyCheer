// theme: メインウィンドウにテーマを当てる(論点 0057)。
// 要件: docs/main-window.md S0057_02 / S0057_03
//
// OS の設定が変わったとき(main が nativeTheme の変化を届ける)と、設定画面で選んだときに、すぐ見た目を変える。
// 見た目の決め方(system なら OS に合わせる)は core/shared/theme が持つ(main と同じ定義を使う)。
// DOM への当て方(<html> の class)と保存(IPC)は呼び出し側(mainEntry)が渡す。
// キャラの窓はこのモジュールを使わない(S0057_05)。

import { resolveTheme, type ResolvedTheme } from "../core/shared/theme.js";
import type { ThemeSetting } from "../core/shared/types.js";

export interface ThemeControllerDeps {
  setting: ThemeSetting;
  isOsDark: boolean;
  apply: (theme: ResolvedTheme) => void;
  save: (setting: ThemeSetting) => void;
}

export interface ThemeController {
  onOsChanged(isOsDark: boolean): void;
  onSettingChanged(setting: ThemeSetting): void;
}

export function createThemeController(deps: ThemeControllerDeps): ThemeController {
  let setting = deps.setting;
  let isOsDark = deps.isOsDark;
  const applyNow = (): void => deps.apply(resolveTheme(setting, isOsDark));
  applyNow();
  return {
    // S0057_02 OS の設定が変わったら、再起動せずに反映する(light / dark を選んでいれば変わらない。S0057_04)
    onOsChanged(next) {
      isOsDark = next;
      applyNow();
    },
    // S0057_03 選んだテーマを保存し、すぐ反映する
    onSettingChanged(next) {
      setting = next;
      deps.save(next);
      applyNow();
    },
  };
}
