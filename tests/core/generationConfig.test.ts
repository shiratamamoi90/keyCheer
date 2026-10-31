// core/generationConfig: 生成の設定(generation)の検証(純粋関数)。
// 要件: docs/main-window.md「メインウィンドウの画面」(論点 0033)

import { describe, it, expect } from "vitest";
import { validateGenerationConfig } from "../../src/core/generationConfig.js";

describe("core/generationConfig / renderer からの設定の変更は main 側で検証する [不変条件]", () => {
  it("S0033_15 rejects a non-boolean shouldActivateOnComplete and accepts a boolean", () => {
    for (const raw of [
      { shouldActivateOnComplete: "false" },
      { shouldActivateOnComplete: 0 },
      {},
      null,
      "x",
    ]) {
      expect(validateGenerationConfig(raw).ok).toBe(false);
    }
    expect(validateGenerationConfig({ shouldActivateOnComplete: false })).toEqual({
      ok: true,
      value: { shouldActivateOnComplete: false },
    });
  });

  it("keeps only the known field (renderer から余計な値を注入させない)", () => {
    expect(validateGenerationConfig({ shouldActivateOnComplete: true, extra: 1 })).toEqual({
      ok: true,
      value: { shouldActivateOnComplete: true },
    });
  });
});
