// popupLayout: キャラの窓の大きさ・位置・マウスを受け取るかの判定(純粋関数)。
// 要件: docs/popup.md「キャラの窓の大きさと位置」S0052_01〜07(論点 0052)/「セリフの置き場と出すかの設定」S0053_01〜03・06(論点 0053)
//
// main(窓を作る・動かす)と renderer(絵の大きさ・ポインタの判定)の両方が使うので shared に置く。
// Electron にも DOM にも触れない。

import type { PopupDisplayConfig } from "./types.js";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface WorkArea extends Point, Size {}

// 窓の中の矩形(窓の左上が原点)
export interface Rect extends Point, Size {}

// S0052_01 キャラの絵は横 128 × 縦 192 に収めて描く — 保存した画像(256x384。S0036_15)の半分。
// 人間が実機を見て決めた大きさ(論点 0052)。保存する大きさは変えない
export const POPUP_IMAGE_SIZE: Size = { width: 128, height: 192 };

// S0053_02 吹き出しは縦が絵の 3 分の 1、横が絵の 1.5 倍を超えない(縦 64 × 横 192)。人間が実機を見て決めた上限(論点 0053)
const MESSAGE_MAX_SIZE: Size = {
  width: (POPUP_IMAGE_SIZE.width * 3) / 2,
  height: POPUP_IMAGE_SIZE.height / 3,
};
// 絵の下端と吹き出しの領域のあいだの隙間(S0053_01「絵のすぐ下」)
const MESSAGE_GAP = 4;
// 窓の左右の縁と、窓の中でいちばん幅のあるもの(吹き出しの領域)とのあいだの余白
const WINDOW_SIDE_MARGIN = 4;

// 窓の大きさ。絵の下に吹き出しの領域を足した高さで、幅は吹き出しの最大幅に合わせる(論点 0053)
export const POPUP_WINDOW_SIZE: Size = {
  width: Math.max(POPUP_IMAGE_SIZE.width, MESSAGE_MAX_SIZE.width) + WINDOW_SIDE_MARGIN * 2,
  height: POPUP_IMAGE_SIZE.height + MESSAGE_GAP + MESSAGE_MAX_SIZE.height,
};

// S0053_01 セリフは絵のすぐ下に出す / S0053_02 吹き出しは縦 64 × 横 192 を超えない
// 絵は窓の上端に、吹き出しの領域はそのすぐ下に、どちらも左右中央で置く。吹き出しはこの領域の上端に寄せて描く
// (セリフが短くても絵のすぐ下に出るように)。配置は窓の中の座標なので、窓をどこへ動かしても変わらない。
export function computePopupContentLayout(): { image: Rect; message: Rect } {
  const image: Rect = {
    x: (POPUP_WINDOW_SIZE.width - POPUP_IMAGE_SIZE.width) / 2,
    y: 0,
    ...POPUP_IMAGE_SIZE,
  };
  const message: Rect = {
    x: (POPUP_WINDOW_SIZE.width - MESSAGE_MAX_SIZE.width) / 2,
    y: image.y + image.height + MESSAGE_GAP,
    ...MESSAGE_MAX_SIZE,
  };
  return { image, message };
}

// 吹き出しの文字の大きさ。30 字(S0024)がおよそ 3 行で縦 64 に収まる大きさを既定にする
const MESSAGE_DEFAULT_FONT_SIZE_PX = 14;
// これより小さくしない(読めなくなるため)。30 字の上限があるので、ふつうはここまで下がらない(論点 0053「決まらなかったこと」)
const MESSAGE_MIN_FONT_SIZE_PX = 8;

// S0053_03 収まらないセリフは文字を小さくして全部出す
// 収まるかの判定(描いて測る)は DOM にしかできないので、呼び出し側から受け取る。
// 切る・広げるのではなく小さくするのは、セリフが欠けると意味が変わるため(論点 0053)
export function computeMessageFontSizePx(isFitting: (fontSizePx: number) => boolean): number {
  for (let size = MESSAGE_DEFAULT_FONT_SIZE_PX; size > MESSAGE_MIN_FONT_SIZE_PX; size -= 1) {
    if (isFitting(size)) return size;
  }
  return MESSAGE_MIN_FONT_SIZE_PX;
}

// S0053_06 セリフも常時表示も切っているときは窓を出さない(出すものが無い。音声だけ鳴らす)
// main(窓を出すか)と renderer(表示の状態)が同じ判定を使う
export function shouldShowWindowOnCheer(config: PopupDisplayConfig): boolean {
  return config.shouldAlwaysShow || config.shouldShowMessage;
}

// 既定の位置の、作業領域の隅からの余白
const POPUP_MARGIN = 24;

// S0052_02 既定の位置は画面の右下
export function computeDefaultPopupPosition(workArea: WorkArea): Point {
  return {
    x: workArea.x + workArea.width - POPUP_WINDOW_SIZE.width - POPUP_MARGIN,
    y: workArea.y + workArea.height - POPUP_WINDOW_SIZE.height - POPUP_MARGIN,
  };
}

function isFullyInside(position: Point, workArea: WorkArea): boolean {
  return (
    position.x >= workArea.x &&
    position.y >= workArea.y &&
    position.x + POPUP_WINDOW_SIZE.width <= workArea.x + workArea.width &&
    position.y + POPUP_WINDOW_SIZE.height <= workArea.y + workArea.height
  );
}

// S0052_06 覚えた位置に出す / S0052_07 覚えた位置が画面の外なら既定の位置に出す
// 保存データは手で書き換えられうるので、形から確かめる。workAreas の先頭を既定の画面として使う。
// 半分だけ画面に残る位置も既定に戻すのは、絵やセリフが見切れたまま動かせなくなるのを避けるため。
export function resolvePopupPosition(saved: unknown, workAreas: readonly WorkArea[]): Point {
  const fallback = computeDefaultPopupPosition(workAreas[0]!);
  if (typeof saved !== "object" || saved === null) return fallback;
  const { x, y } = saved as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return fallback;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return fallback;
  return workAreas.some((workArea) => isFullyInside({ x, y }, workArea)) ? { x, y } : fallback;
}

// S0052_03 ポインタが絵の上にある間だけマウスを受け取る(ドラッグの途中は外れても受け取り続ける)
// S0052_04 絵が出ていないときはマウスを受け取らない
//
// 受け取るのを絵の上だけに絞るのは、キャラの窓が打鍵中も最前面に出ていて、下のアプリの操作を
// ふさがないため(S0017_06 / S0036_25)。セリフの吹き出しはクリックを通す。
export function shouldCaptureMouse(input: {
  isImageShown: boolean;
  isOverImage: boolean;
  isDragging: boolean;
}): boolean {
  return input.isImageShown && (input.isOverImage || input.isDragging);
}

// S0052_05 絵をドラッグすると、ポインタが動いた分だけ窓が動く
// 押したときの窓の位置とポインタの位置を基準にする(動かすたびの差分を足していくと、取りこぼしでずれる)
export function computeDraggedPosition(
  start: { window: Point; pointer: Point },
  pointer: Point,
): Point {
  return {
    x: start.window.x + (pointer.x - start.pointer.x),
    y: start.window.y + (pointer.y - start.pointer.y),
  };
}
