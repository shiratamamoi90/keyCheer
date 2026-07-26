// renderer/generationView: 生成ボタンと進捗表示の状態遷移(純粋関数)。
// spec: changes/0011-pool-generation-and-playback/spec.md
// DOM 操作は I/O グルーでテスト対象外。ここでは「いつ押せるか」「何を出すか」だけを縛る。

import { describe, it, expect } from "vitest";
import {
  initialGenerationState,
  applyGenerationEvent,
  canStartGeneration,
  progressLabel,
  type GenerationViewState,
} from "../../src/renderer/generationView.js";

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
    s = applyGenerationEvent(s, { type: "progress", phase: "voice", done: 1, total: 192 });
    expect(s.phase).toBe("voice");
    expect(progressLabel(s)).toContain("192");
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
