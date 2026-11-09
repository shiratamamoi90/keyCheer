// popupDisplayConfig: 常時表示の設定(popup.shouldAlwaysShow)の検証。
// spec: docs/main-window.md S0036_29 / docs/data-model.md(論点 0036)
// 純粋関数のみ。main が renderer からの変更を保存する前に呼ぶ(信頼境界。security-rules.md)。

import type { PopupDisplayConfig } from "./shared/types.js";

export type ValidatePopupDisplayConfigResult =
  | { ok: true; value: PopupDisplayConfig }
  | { ok: false; errors: string[] };

// 既知の項目だけを取り出す。renderer から余計な値を保存させない(S0033_15 と同じ扱い)。
// 読み込み時の扱い(真偽値でなければ既定値として読む = S0036_27)とは別 — こちらは保存を拒否する。
export function validatePopupDisplayConfig(raw: unknown): ValidatePopupDisplayConfigResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["popup display must be an object"] };
  }
  const value = (raw as Record<string, unknown>).shouldAlwaysShow;
  if (typeof value !== "boolean") {
    return { ok: false, errors: ["shouldAlwaysShow must be a boolean"] };
  }
  return { ok: true, value: { shouldAlwaysShow: value } };
}
