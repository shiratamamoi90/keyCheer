// popupPointer: キャラの窓のポインタの通知を受けて、マウスを受け取るか・窓をどこへ動かすかを決める。
// 要件: docs/popup.md「キャラの窓の大きさと位置」(論点 0052)
//
// electron に触れない(窓の操作は deps で受け取る)。判定と位置の計算は core/shared/popupLayout が持ち、
// ここは renderer から届いた状態を覚えてそれを呼ぶだけ。

import {
  computeDraggedPosition,
  shouldCaptureMouse,
  type Point,
} from "../core/shared/popupLayout.js";
import type { PopupPointerEvent } from "../core/shared/ipc.js";

export interface PopupPointerDeps {
  // いまキャラの絵が描かれているか(S0052_04。描かれていなければ何が届いても受け取らない)
  isImageShown(): boolean;
  setCaptureMouse(shouldCapture: boolean): void;
  getWindowPosition(): Point;
  setWindowPosition(position: Point): void;
  savePosition(position: Point): void;
}

export interface PopupPointerHandler {
  handle(raw: unknown): void;
  // 絵の表示が切り替わった・窓を隠したとき。ポインタの状態を忘れ、クリックを通す状態へ戻す
  reset(): void;
}

// 信頼境界:renderer から届く値は形を確かめてから使う(security-rules.md「入力と信頼境界」)
function parsePopupPointerEvent(raw: unknown): PopupPointerEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { type, screenX, screenY } = raw as Record<string, unknown>;
  if (type === "enter" || type === "leave") return { type };
  if (type !== "drag-start" && type !== "drag-move" && type !== "drag-end") return null;
  if (typeof screenX !== "number" || typeof screenY !== "number") return null;
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
  return { type, screenX, screenY };
}

export function createPopupPointerHandler(deps: PopupPointerDeps): PopupPointerHandler {
  let isOverImage = false;
  let dragStart: { window: Point; pointer: Point } | null = null;

  const applyCapture = (): void => {
    deps.setCaptureMouse(
      shouldCaptureMouse({
        isImageShown: deps.isImageShown(),
        isOverImage,
        isDragging: dragStart !== null,
      }),
    );
  };

  // 窓の位置は整数で置く(Electron の setPosition と、覚えた位置の検証 resolvePopupPosition が整数を求める)。
  // 高 DPI の画面では screenX が小数になりうる
  const draggedPosition = (
    start: { window: Point; pointer: Point },
    x: number,
    y: number,
  ): Point => {
    const moved = computeDraggedPosition(start, { x, y });
    return { x: Math.round(moved.x), y: Math.round(moved.y) };
  };

  return {
    handle(raw) {
      const event = parsePopupPointerEvent(raw);
      if (event === null) return;
      switch (event.type) {
        case "enter":
          isOverImage = true;
          break;
        case "leave":
          isOverImage = false;
          break;
        case "drag-start":
          // 絵が出ていないときはドラッグを始めない(S0052_04)
          if (!deps.isImageShown()) break;
          dragStart = {
            window: deps.getWindowPosition(),
            pointer: { x: event.screenX, y: event.screenY },
          };
          break;
        case "drag-move":
          if (dragStart === null) break;
          deps.setWindowPosition(draggedPosition(dragStart, event.screenX, event.screenY));
          break;
        case "drag-end": {
          if (dragStart === null) break;
          const position = draggedPosition(dragStart, event.screenX, event.screenY);
          dragStart = null;
          deps.setWindowPosition(position);
          // S0052_06 離した位置を覚える(動かしている途中は書かない。ディスクへの書き込みを離したときの 1 回にする)
          deps.savePosition(position);
          break;
        }
      }
      applyCapture();
    },
    reset() {
      isOverImage = false;
      dragStart = null;
      applyCapture();
    },
  };
}
