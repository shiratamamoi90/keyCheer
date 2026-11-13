// renderer/generationView: 生成ボタンと進捗表示の状態遷移(純粋関数)。
// spec: 論点 0020
// DOM 操作は I/O グルーでテスト対象外。ここでは「いつ押せるか」「何を出すか」だけを縛る。

import { describe, it, expect } from "vitest";
import {
  initialGenerationState,
  applyGenerationEvent,
  canStartGeneration,
  progressLabel,
  shouldConfirmRebuild,
  REBUILD_CONFIRMATION_TEXT,
  START_GENERATION_LABEL,
  type GenerationViewState,
} from "../../src/renderer/generationView.js";
import type { GenerationImagesSummary } from "../../src/core/shared/ipc.js";

const IDLE = initialGenerationState();

describe("generationView / 生成の進捗が通知される", () => {
  it("starts idle with no progress", () => {
    expect(IDLE.phase).toBe("idle");
    expect(progressLabel(IDLE)).toBe("");
  });

  it("reflects the text phase progress", () => {
    const s = applyGenerationEvent(IDLE, { type: "progress", phase: "text", done: 5, total: 24 });
    expect(s.phase).toBe("text");
    expect(progressLabel(s)).toContain("5");
    expect(progressLabel(s)).toContain("24");
  });

  it("moves on to the voice phase", () => {
    let s = applyGenerationEvent(IDLE, { type: "progress", phase: "text", done: 24, total: 24 });
    s = applyGenerationEvent(s, { type: "progress", phase: "voice", done: 1, total: 48 });
    expect(s.phase).toBe("voice");
    expect(progressLabel(s)).toContain("48");
  });

  it("shows a completion state with the synthesized counts", () => {
    const s = applyGenerationEvent(IDLE, { type: "done", synthesized: 190, missing: 2 });
    expect(s.phase).toBe("done");
    expect(progressLabel(s)).toContain("190");
  });

  it("shows a failure without crashing", () => {
    const s = applyGenerationEvent(IDLE, { type: "failed", reason: "text-generation-failed" });
    expect(s.phase).toBe("failed");
    expect(progressLabel(s).length).toBeGreaterThan(0);
  });
});

describe("generationView / 生成中に再度生成を開始できない [境界]", () => {
  it("disables start while a phase is in flight", () => {
    for (const phase of ["text", "voice"] as const) {
      const s: GenerationViewState = applyGenerationEvent(IDLE, {
        type: "progress",
        phase,
        done: 1,
        total: 10,
      });
      expect(canStartGeneration(s, true)).toBe(false);
    }
  });

  it("allows start when idle, done or failed", () => {
    const done = applyGenerationEvent(IDLE, { type: "done", synthesized: 1, missing: 0 });
    const failed = applyGenerationEvent(IDLE, { type: "failed", reason: "cancelled" });
    expect(canStartGeneration(IDLE, true)).toBe(true);
    expect(canStartGeneration(done, true)).toBe(true);
    expect(canStartGeneration(failed, true)).toBe(true);
  });

  it("never allows start without a saved character", () => {
    expect(canStartGeneration(IDLE, false)).toBe(false);
  });
});

describe("generationView / ビューモデルは純粋", () => {
  it("does not mutate the previous state", () => {
    const before = { ...IDLE };
    applyGenerationEvent(IDLE, { type: "progress", phase: "text", done: 1, total: 24 });
    expect(IDLE).toEqual(before);
  });
});

describe("generationView / 作り直す前の確認(論点 0038)", () => {
  // 作り直しかどうかは main が決めて応答で返す(main/generationStart)。renderer は応答を見て確認を出すだけ。
  it("asks for confirmation only when main answers that a rebuild needs it", () => {
    expect(shouldConfirmRebuild({ ok: false, reason: "rebuild-confirmation-required" })).toBe(true);
    expect(shouldConfirmRebuild({ ok: true })).toBe(false);
    expect(shouldConfirmRebuild({ ok: false, reason: "already-running" })).toBe(false);
  });

  it("tells that the pool, voices and images will be rebuilt", () => {
    expect(REBUILD_CONFIRMATION_TEXT).toContain("作り直");
    expect(REBUILD_CONFIRMATION_TEXT).toContain("音声");
    expect(REBUILD_CONFIRMATION_TEXT).toContain("画像");
  });
});

// 画像の結果を完了の文言に出す(docs/pool-generation.md の「画像の一部が失敗しても…」「画像プロバイダーが使えなくても…」の
// 「エラーを表示する」を画面まで届ける)
describe("generationView / 完了の文言に画像の結果を出す", () => {
  const done = (images: GenerationImagesSummary) =>
    progressLabel(
      applyGenerationEvent(initialGenerationState(), {
        type: "done",
        synthesized: 48,
        missing: 0,
        images,
      }),
    );

  it("says how many images were made when all of them were made", () => {
    expect(done({ saved: 3, total: 3, unavailableReason: null })).toBe(
      "完了しました(音声 48 本、画像 3 枚)",
    );
  });

  it("says that some images could not be made", () => {
    expect(done({ saved: 1, total: 3, unavailableReason: null })).toBe(
      "完了しました(音声 48 本、画像 1 枚。2 枚は作れませんでした)",
    );
  });

  it("says that no image could be made", () => {
    expect(done({ saved: 0, total: 3, unavailableReason: null })).toBe(
      "完了しました(音声 48 本。画像は作れませんでした)",
    );
  });

  it("says why the images were not made when the image provider was unavailable", () => {
    expect(done({ saved: 0, total: 3, unavailableReason: "runtime-not-installed" })).toBe(
      "完了しました(音声 48 本。画像は作っていません:画像生成のモデルの重みがありません)",
    );
    expect(done({ saved: 0, total: 3, unavailableReason: "missing-api-key" })).toBe(
      "完了しました(音声 48 本。画像は作っていません:画像プロバイダーの API キーがありません)",
    );
    expect(done({ saved: 0, total: 3, unavailableReason: "consent-required" })).toBe(
      "完了しました(音声 48 本。画像は作っていません:画像プロバイダーへの送信に同意していません)",
    );
  });

  it("keeps the missing voice count next to the image result", () => {
    const label = progressLabel(
      applyGenerationEvent(initialGenerationState(), {
        type: "done",
        synthesized: 46,
        missing: 2,
        images: { saved: 3, total: 3, unavailableReason: null },
      }),
    );
    expect(label).toBe("完了しました(音声 46 本、2 本は音声なし、画像 3 枚)");
  });

  it("says nothing about images when the event carries no image result", () => {
    const label = progressLabel(
      applyGenerationEvent(initialGenerationState(), { type: "done", synthesized: 48, missing: 0 }),
    );
    expect(label).toBe("完了しました(音声 48 本)");
  });
});

describe("generationView / 生成ボタンの文言", () => {
  it("names the message, the voice and the image", () => {
    expect(START_GENERATION_LABEL).toBe("応援メッセージ・音声・画像を生成");
  });
});
