// renderer/theme: メインウィンドウにテーマを当てる(OS の設定の変化・設定の変更をすぐ反映する)。
// 要件: docs/main-window.md(論点 0057)

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createThemeController } from "../../src/renderer/theme.js";

function setup(setting: "system" | "light" | "dark", isOsDark: boolean) {
  const applied: string[] = [];
  const saved: string[] = [];
  const controller = createThemeController({
    setting,
    isOsDark,
    apply: (theme) => applied.push(theme),
    save: (next) => saved.push(next),
  });
  return { controller, applied, saved };
}

describe("theme / OS の設定が変わったら開いているメインウィンドウにすぐ反映する", () => {
  it("S0057_02 switches to dark when the OS turns dark under system", () => {
    // GIVEN ui.theme = system、表示中(ライト)
    const { controller, applied } = setup("system", false);
    expect(applied).toEqual(["light"]);
    // WHEN OS がダークに変わる
    controller.onOsChanged(true);
    // THEN 再起動せずダークになる
    expect(applied).toEqual(["light", "dark"]);
  });
});

describe("theme / 設定画面でテーマを選ぶとすぐ反映する", () => {
  it("S0057_03 saves dark and applies it at once", () => {
    // GIVEN ui.theme = system、OS はライト
    const { controller, applied, saved } = setup("system", false);
    // WHEN 設定画面でダークを選んで保存する
    controller.onSettingChanged("dark");
    // THEN dark を保存し、すぐダークになる
    expect(saved).toEqual(["dark"]);
    expect(applied.at(-1)).toBe("dark");
  });
});

describe("theme / テーマはキャラの窓と確認ダイアログを変えない [否定]", () => {
  it("S0057_05 the popup does not read the theme and the OS theme source is never overridden", () => {
    // キャラの窓(popup.html / popup.ts / popupView.ts)はテーマを読まない
    for (const file of [
      "src/renderer/popup.html",
      "src/renderer/popup.ts",
      "src/renderer/popupView.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/theme|Theme|prefers-color-scheme/);
    }
    // 確認ダイアログは OS の設定に従う:アプリが nativeTheme.themeSource を書き換えない
    const mainFiles = readdirSync("src/main").filter((f) => f.endsWith(".ts"));
    for (const file of mainFiles) {
      expect(readFileSync(`src/main/${file}`, "utf8"), file).not.toMatch(/themeSource/);
    }
  });
});
