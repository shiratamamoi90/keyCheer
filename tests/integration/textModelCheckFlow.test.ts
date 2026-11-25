// 総合(経路): 置き場のテキストモデルの照合 → 生成を始めるかの判断 → 画面の案内、を 1 本で通す。
// 本物の一時ファイルと本物の sha256 の計算をつなぎ、通ったら始め、壊れたら始めずに入れ直しを案内することを見る。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFileSha256,
  isTextModelIntact,
  resolveTextModelPath,
} from "../../src/main/textModelCheck.js";
import {
  applyGenerationEvent,
  initialGenerationState,
  progressLabel,
} from "../../src/renderer/generationView.js";

describe("総合: テキストモデルを照合してから生成を始め、壊れていれば入れ直しを案内する", () => {
  it("starts on a matching GGUF and shows the reinstall notice once it is broken", async () => {
    const userData = mkdtempSync(join(tmpdir(), "keycheer-userdata-"));
    const path = resolveTextModelPath(userData);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "gguf-body");
    const expectedSha256 = createHash("sha256").update("gguf-body").digest("hex");
    const check = () =>
      isTextModelIntact({ path, expectedSha256, computeSha256: computeFileSha256 });

    expect(await check()).toBe(true);

    // 生成の合間に壊れた → 次の生成の開始で照合し直して止まり、main の理由が画面の案内になる
    writeFileSync(path, "gguf-bodX");
    expect(await check()).toBe(false);
    const state = applyGenerationEvent(initialGenerationState(), {
      type: "failed",
      reason: "text-model-missing",
    });
    expect(progressLabel(state)).toContain("インストーラで入れ直してください");
  });
});
