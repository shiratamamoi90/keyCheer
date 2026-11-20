// core/shared/popupLayout: キャラの窓の大きさ・位置・マウスを受け取るかの判定(純粋関数)。
// 要件: docs/popup.md「キャラの窓の大きさと位置」(論点 0052)

import { describe, it, expect } from "vitest";
import {
  POPUP_IMAGE_SIZE,
  POPUP_WINDOW_SIZE,
  computeDefaultPopupPosition,
  computeDraggedPosition,
  computePopupContentLayout,
  resolvePopupPosition,
  shouldCaptureMouse,
} from "../../../src/core/shared/popupLayout.js";

const WORK_AREA = { x: 0, y: 0, width: 1536, height: 824 };

describe("popupLayout / キャラの絵は横 128 × 縦 192 に収めて描く", () => {
  it("S0052_01 pins the display size to half of the saved image", () => {
    // GIVEN 256x384 で保存されたキャラ画像
    // WHEN キャラの窓に描く
    // THEN 横 128 × 縦 192 に収まる大きさで描く
    expect(POPUP_IMAGE_SIZE).toEqual({ width: 128, height: 192 });
    expect(POPUP_WINDOW_SIZE.height).toBeGreaterThan(POPUP_IMAGE_SIZE.height);
    expect(POPUP_WINDOW_SIZE.width).toBeGreaterThanOrEqual(POPUP_IMAGE_SIZE.width);
  });
});

describe("popupLayout / 窓は絵とセリフがおさまる大きさで、既定の位置は画面の右下", () => {
  it("S0052_02 puts the window at the bottom right, fully inside the work area", () => {
    // GIVEN 位置を動かしたことが無い
    // WHEN キャラの窓を作る
    const position = computeDefaultPopupPosition(WORK_AREA);

    // THEN 右下の隅から余白 24 をあけた位置で、窓の全体が作業領域の中におさまる
    expect(position).toEqual({
      x: 1536 - POPUP_WINDOW_SIZE.width - 24,
      y: 824 - POPUP_WINDOW_SIZE.height - 24,
    });
    expect(resolvePopupPosition(null, [WORK_AREA])).toEqual(position);
  });
});

describe("popupLayout / ポインタが絵の上にある間だけマウスを受け取る", () => {
  it("S0052_03 captures the mouse over the image and keeps capturing during a drag", () => {
    // GIVEN 常時表示でキャラの絵が出ている
    const shown = { isImageShown: true };

    // WHEN ポインタが絵の上に入る / 絵の外に出る / ドラッグの途中で絵から外れる
    // THEN 絵の上にある間と、ドラッグの途中だけ受け取る
    expect(shouldCaptureMouse({ ...shown, isOverImage: true, isDragging: false })).toBe(true);
    expect(shouldCaptureMouse({ ...shown, isOverImage: false, isDragging: false })).toBe(false);
    expect(shouldCaptureMouse({ ...shown, isOverImage: false, isDragging: true })).toBe(true);
  });
});

describe("popupLayout / 絵が出ていないときはマウスを受け取らない [否定]", () => {
  it("S0052_04 never captures the mouse while no image is drawn", () => {
    // GIVEN キャラの絵が描かれていない
    // WHEN ポインタが窓の上を動く
    // THEN 窓はマウスを受け取らない
    expect(shouldCaptureMouse({ isImageShown: false, isOverImage: true, isDragging: false })).toBe(
      false,
    );
    expect(shouldCaptureMouse({ isImageShown: false, isOverImage: true, isDragging: true })).toBe(
      false,
    );
  });
});

describe("popupLayout / 絵をドラッグすると、ポインタが動いた分だけ窓が動く", () => {
  it("S0052_05 moves the window by the distance the pointer moved", () => {
    // GIVEN 窓が (800, 400) にあり、絵の上でポインタを (900, 500) で押した
    const start = { window: { x: 800, y: 400 }, pointer: { x: 900, y: 500 } };

    // WHEN ポインタを右へ 30、上へ 20 動かす
    const moved = computeDraggedPosition(start, { x: 930, y: 480 });

    // THEN 窓は (830, 380) に動く
    expect(moved).toEqual({ x: 830, y: 380 });
  });
});

describe("popupLayout / 覚えた位置が画面の外なら既定の位置に出す [境界]", () => {
  it("S0052_07 falls back to the default position when the saved one does not fit any work area", () => {
    // GIVEN 覚えた位置に置くと窓がどの作業領域にもおさまらない、または値が数値でない
    const fallback = computeDefaultPopupPosition(WORK_AREA);
    const second = { x: 1536, y: 0, width: 1280, height: 700 };

    // WHEN キャラの窓を作る
    // THEN 既定の位置に出す(おさまる位置はそのまま使う)
    expect(resolvePopupPosition({ x: 5000, y: 100 }, [WORK_AREA])).toEqual(fallback);
    expect(resolvePopupPosition({ x: -50, y: 100 }, [WORK_AREA])).toEqual(fallback);
    expect(resolvePopupPosition({ x: "830", y: 380 }, [WORK_AREA])).toEqual(fallback);
    expect(resolvePopupPosition({ x: 830.5, y: Number.NaN }, [WORK_AREA])).toEqual(fallback);
    expect(resolvePopupPosition({ x: 830, y: 380 }, [WORK_AREA])).toEqual({ x: 830, y: 380 });
    expect(resolvePopupPosition({ x: 1600, y: 100 }, [WORK_AREA, second])).toEqual({
      x: 1600,
      y: 100,
    });
  });
});

describe("popupLayout / セリフは絵のすぐ上に、窓の中に収めて出す", () => {
  it("S0052_08 places the message right above the image, inside the window", () => {
    // GIVEN キャラの絵が出ている窓(窓の中の配置は窓の位置によらない)
    // WHEN 応援が発動してセリフを出す
    const { image, message } = computePopupContentLayout();

    // THEN 絵は 128x192 のまま窓の中にあり、セリフは絵のすぐ上(隙間 0〜8)で、窓からはみ出さない
    expect({ width: image.width, height: image.height }).toEqual({ width: 128, height: 192 });
    expect(image.x).toBeGreaterThanOrEqual(0);
    expect(image.x + image.width).toBeLessThanOrEqual(POPUP_WINDOW_SIZE.width);
    expect(image.y + image.height).toBeLessThanOrEqual(POPUP_WINDOW_SIZE.height);

    const gap = image.y - (message.y + message.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(8);
    expect(message.x).toBeGreaterThanOrEqual(0);
    expect(message.y).toBeGreaterThanOrEqual(0);
    expect(message.x + message.width).toBeLessThanOrEqual(POPUP_WINDOW_SIZE.width);
    expect(message.height).toBeGreaterThan(0);

    // セリフは絵の真上にある(横の範囲が重なる)
    expect(message.x).toBeLessThan(image.x + image.width);
    expect(message.x + message.width).toBeGreaterThan(image.x);
  });
});
