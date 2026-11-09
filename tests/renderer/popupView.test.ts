// renderer/popupView: CheerFiredPayload → 表示内容 / 表示時間 / 音声再生の有無 の純粋な写像。
// spec: 論点 0017
//   発動でポップアップが表示される / 表示時間が過ぎたら消える [境界] /
//   表示中に次の発動が来たら上書きする / wav がある発動で音声も再生する /
//   wav が無い発動はテキストのみ [異常系] / 入力内容は renderer に渡らない [不変条件]
// ウィンドウ生成・IPC そのものは I/O グルーなのでここでは扱わない(実機確認で補う)。

import { describe, it, expect } from "vitest";
import {
  applyCharacterDisplay,
  initialPopupState,
  showCheer,
  tick,
  type PopupState,
} from "../../src/renderer/popupView.js";
import type { CheerFiredPayload } from "../../src/core/shared/ipc.js";

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
  it("S0017_01 shows the payload message", () => {
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
  it("S0017_02 stays visible until just before popupDurationMs", () => {
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
  it("S0017_03 replaces the text and resets the remaining time (キューに積まない)", () => {
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
  it("S0017_04 returns the wav path to play once", () => {
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
  it("S0017_05 returns no wav path and still shows the text", () => {
    const { state, playWavPath } = showCheer(initialPopupState, payload({ wavPath: null }), 1_000);
    expect(playWavPath).toBeNull();
    expect(state.visible).toBe(true);
    expect(state.text).toBe("いいペースだね!");
  });
});

describe("popupView / 入力内容は renderer に渡らない [不変条件]", () => {
  it("keeps only display fields in the view state", () => {
    const { state } = showCheer(initialPopupState, payload(), 1_000);
    // 論点 0036 で画像のパス(待機画像・いま描く画像)と常時表示を足した。どれも表示に使う値で、入力内容ではない
    expect(Object.keys(state).sort()).toEqual([
      "durationMs",
      "idleImagePath",
      "imagePath",
      "shouldAlwaysShow",
      "shownAt",
      "text",
      "visible",
    ]);
  });
});

// キャラ画像の常時表示と切り替え(論点 0036)。docs/popup.md
const IDLE = "/userData/characters/c/images/idle.png";
const MILESTONE = "/userData/characters/c/images/milestone.png";

describe("popupView / 常時表示なら待機画像を出し続ける", () => {
  it("S0036_18 keeps the window shown with the idle image and no text", () => {
    // GIVEN 常時表示、使用中のキャラクターに待機画像がある / WHEN 応援が出ていない
    const state = applyCharacterDisplay(initialPopupState, {
      idleImagePath: IDLE,
      shouldAlwaysShow: true,
    });

    // THEN 窓が表示され、待機画像を描き、文言は描かない
    expect(state.visible).toBe(true);
    expect(state.imagePath).toBe(IDLE);
    expect(state.text).toBe("");
  });
});

describe("popupView / 応援でその応援種別の画像に切り替え、表示時間の後に待機画像へ戻す", () => {
  it("S0036_19 shows the milestone image with the text, then returns to the idle image without hiding", () => {
    // GIVEN 常時表示で待機画像を表示中
    const idle = applyCharacterDisplay(initialPopupState, {
      idleImagePath: IDLE,
      shouldAlwaysShow: true,
    });

    // WHEN milestone の応援が発動する
    const { state: cheering } = showCheer(
      idle,
      payload({ type: "milestone", message: "1000 回達成!", imagePath: MILESTONE }),
      1_000,
    );

    // THEN 文言とともに milestone の画像を描く
    expect(cheering.text).toBe("1000 回達成!");
    expect(cheering.imagePath).toBe(MILESTONE);
    // 表示時間が過ぎたら文言を消して待機画像に戻し、窓は消さない
    const after = tick(cheering, 6_000);
    expect(after.visible).toBe(true);
    expect(after.text).toBe("");
    expect(after.imagePath).toBe(IDLE);
  });
});

describe("popupView / その応援種別の画像が無ければ待機画像を出す [異常系]", () => {
  it("S0036_20 falls back to the idle image when the payload has no image", () => {
    const idle = applyCharacterDisplay(initialPopupState, {
      idleImagePath: IDLE,
      shouldAlwaysShow: true,
    });

    const { state } = showCheer(idle, payload({ imagePath: null }), 1_000);

    expect(state.text).toBe("いいペースだね!");
    expect(state.imagePath).toBe(IDLE);
  });
});

describe("popupView / 待機画像も無ければ画像を出さない [異常系]", () => {
  it("S0036_21 draws no image while idle nor while cheering when there is no idle image", () => {
    const idle = applyCharacterDisplay(initialPopupState, {
      idleImagePath: null,
      shouldAlwaysShow: true,
    });
    expect(idle.imagePath).toBeNull();

    const { state, playWavPath } = showCheer(
      idle,
      payload({ imagePath: null, wavPath: "/userData/characters/c/voices/m.wav" }),
      1_000,
    );

    expect(state.imagePath).toBeNull();
    expect(state.text).toBe("いいペースだね!");
    expect(playWavPath).toBe("/userData/characters/c/voices/m.wav");
  });
});

describe("popupView / 常時表示を切ると発動時だけ文言を出す [否定]", () => {
  it("S0036_24 hides the window while idle and never draws an image", () => {
    // GIVEN 常時表示を切り、使用中のキャラクターに画像がある
    const idle = applyCharacterDisplay(initialPopupState, {
      idleImagePath: IDLE,
      shouldAlwaysShow: false,
    });
    // 応援が出ていない間は窓を出さない
    expect(idle.visible).toBe(false);

    // 発動時は文言だけを出し、画像は描かない
    const { state } = showCheer(idle, payload({ imagePath: MILESTONE }), 1_000);
    expect(state.visible).toBe(true);
    expect(state.imagePath).toBeNull();
    // 表示時間が過ぎたら消える(論点 0017 の挙動のまま)
    expect(tick(state, 6_000).visible).toBe(false);
  });
});
