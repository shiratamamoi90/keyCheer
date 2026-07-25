// renderer/popupView: CheerFiredPayload → 表示内容 / 表示時間 / 音声再生の有無 の純粋な写像。
// spec: changes/0007-runnable-popup-slice/spec.md
//   発動でポップアップが表示される / 表示時間が過ぎたら消える [境界] /
//   表示中に次の発動が来たら上書きする / wav がある発動で音声も再生する /
//   wav が無い発動はテキストのみ [異常系] / 入力内容は renderer に渡らない [不変条件]
// ウィンドウ生成・IPC そのものは I/O グルーなのでここでは扱わない(実機確認で補う)。

import { describe, it, expect } from "vitest";
import {
  initialPopupState,
  showCheer,
  tick,
  type PopupState,
} from "../../src/renderer/popupView.js";
import type { CheerFiredPayload } from "../../src/shared/ipc.js";

function payload(overrides: Partial<CheerFiredPayload> = {}): CheerFiredPayload {
  return {
    count: 50,
    kpm: 120,
    speedZone: "normal",
    timeOfDay: "morning",
    type: "regular",
    messageId: "normal_regular_morning-000",
    message: "いいペースだね!",
    wavPath: null,
    popupDurationMs: 5000,
    ...overrides,
  };
}

describe("popupView / 発動でポップアップが表示される", () => {
  it("shows the payload message", () => {
    const { state } = showCheer(initialPopupState, payload(), 1_000);
    expect(state.visible).toBe(true);
    expect(state.text).toBe("いいペースだね!");
    expect(state.shownAt).toBe(1_000);
    expect(state.durationMs).toBe(5000);
  });

  it("does not mutate the previous state (pure)", () => {
    const before: PopupState = { ...initialPopupState };
    showCheer(before, payload(), 1_000);
    expect(before).toEqual(initialPopupState);
  });
});

describe("popupView / 表示時間が過ぎたら消える [境界]", () => {
  it("stays visible until just before popupDurationMs", () => {
    const { state } = showCheer(initialPopupState, payload(), 1_000);
    expect(tick(state, 1_000 + 4_999).visible).toBe(true);
  });

  it("hides exactly at popupDurationMs (strict less-than で表示中を判定)", () => {
    const { state } = showCheer(initialPopupState, payload(), 1_000);
    expect(tick(state, 1_000 + 5_000).visible).toBe(false);
  });

  it("stays hidden afterwards", () => {
    const { state } = showCheer(initialPopupState, payload(), 1_000);
    const hidden = tick(state, 1_000 + 9_999);
    expect(hidden.visible).toBe(false);
    expect(tick(hidden, 1_000 + 20_000).visible).toBe(false);
  });
});

describe("popupView / 表示中に次の発動が来たら上書きする", () => {
  it("replaces the text and resets the remaining time (キューに積まない)", () => {
    const first = showCheer(initialPopupState, payload({ message: "A" }), 1_000).state;
    // 残り 2000ms の時点で次の発動
    const second = showCheer(first, payload({ message: "B" }), 1_000 + 3_000).state;

    expect(second.text).toBe("B");
    expect(second.shownAt).toBe(4_000);
    // 上書き直後は A の期限(6000)を過ぎても表示され続ける
    expect(tick(second, 6_500).visible).toBe(true);
    expect(tick(second, 9_000).visible).toBe(false);
  });
});

describe("popupView / wav がある発動で音声も再生する", () => {
  it("returns the wav path to play once", () => {
    const wavPath = "/userData/characters/chia/voices/m001.wav";
    const { playWavPath } = showCheer(initialPopupState, payload({ wavPath }), 1_000);
    expect(playWavPath).toBe(wavPath);
  });

  it("does not replay on subsequent ticks", () => {
    const wavPath = "/userData/characters/chia/voices/m001.wav";
    const { state } = showCheer(initialPopupState, payload({ wavPath }), 1_000);
    // tick は表示状態だけを進める(再生指示を返さない)
    expect(tick(state, 1_500)).not.toHaveProperty("playWavPath");
  });
});

describe("popupView / wav が無い発動はテキストのみ [異常系]", () => {
  it("returns no wav path and still shows the text", () => {
    const { state, playWavPath } = showCheer(initialPopupState, payload({ wavPath: null }), 1_000);
    expect(playWavPath).toBeNull();
    expect(state.visible).toBe(true);
    expect(state.text).toBe("いいペースだね!");
  });
});

describe("popupView / 入力内容は renderer に渡らない [不変条件]", () => {
  it("keeps only display fields in the view state", () => {
    const { state } = showCheer(initialPopupState, payload(), 1_000);
    expect(Object.keys(state).sort()).toEqual(["durationMs", "shownAt", "text", "visible"]);
  });
});
