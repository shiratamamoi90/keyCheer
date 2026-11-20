// popupDisplayConfig: キャラの窓の表示の設定(popup.shouldAlwaysShow / popup.shouldShowMessage)の検証。
// spec: docs/main-window.md S0036_29 / S0053_09 / docs/data-model.md(論点 0036 / 0053)
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
  const { shouldAlwaysShow, shouldShowMessage } = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof shouldAlwaysShow !== "boolean") errors.push("shouldAlwaysShow must be a boolean");
  // S0053_09 セリフを出すかの不正な値は保存しない
  if (typeof shouldShowMessage !== "boolean") errors.push("shouldShowMessage must be a boolean");
  if (typeof shouldAlwaysShow !== "boolean" || typeof shouldShowMessage !== "boolean") {
    return { ok: false, errors };
  }
  return { ok: true, value: { shouldAlwaysShow, shouldShowMessage } };
}
