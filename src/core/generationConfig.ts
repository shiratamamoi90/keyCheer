// generationConfig: 生成の設定(generation)の検証。
// spec: docs/main-window.md「メインウィンドウの画面」(論点 0033)
// 純粋関数のみ。main が renderer からの変更を保存する前に呼ぶ(信頼境界。security-rules.md)。

import type { GenerationConfig } from "./shared/types.js";

export type ValidateGenerationConfigResult =
  | { ok: true; value: GenerationConfig }
  | { ok: false; errors: string[] };

// S0033_15 renderer からの設定の変更は main 側で検証する [不変条件]
// 既知の項目だけを取り出す。renderer から余計な値を保存させない。
// 読み込み時の扱い(真偽値でなければ既定値として読む = S0032_31)とは別 — こちらは保存を拒否する。
export function validateGenerationConfig(raw: unknown): ValidateGenerationConfigResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["generation must be an object"] };
  }
  const value = (raw as Record<string, unknown>).shouldActivateOnComplete;
  if (typeof value !== "boolean") {
    return { ok: false, errors: ["shouldActivateOnComplete must be a boolean"] };
  }
  return { ok: true, value: { shouldActivateOnComplete: value } };
}
