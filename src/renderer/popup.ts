// popup: 応援ポップアップの描画エントリ。表示判断は popupView(純粋関数)に委譲する。
// spec: 論点 0017
// この層は DOM 操作と音声再生だけを行う I/O グルー — テスト対象外(popupView 側で縛る)。
// core / providers / agent は import しない(発動経路の不変条件。ESLint で強制)。

import {
  applyCharacterDisplay,
  initialPopupState,
  showCheer,
  tick,
  type PopupState,
} from "./popupView.js";
import { AUDIO_SCHEME, buildImageUrl } from "../core/shared/ipc.js";
import {
  computeMessageFontSizePx,
  computePopupContentLayout,
  type Rect,
} from "../core/shared/popupLayout.js";
import { APP_DISPLAY_NAME } from "../core/shared/appIdentity.js";

// window.keycheer の型は globals.d.ts(メインウィンドウと共有)
// 論点 0077 窓の題名は見える名前の定義から付ける(HTML に名前を直書きしない)
document.title = APP_DISPLAY_NAME;

// wav は file:// を直接開かず、main が登録した専用スキーム経由で読む(spec 確定事項 #4)。
// スキーム名は core/shared/ipc.ts が正本(main 側と同じ値を参照する)。

function audioUrl(wavPath: string): string {
  return `${AUDIO_SCHEME}://play/${encodeURIComponent(wavPath)}`;
}

function placeAt(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

// S0052_03 / S0052_05 絵の上のポインタとドラッグを main に伝える(窓を動かすのは main)。
// 絵が隠れている間は img がポインタを受けないので、何も送らない(S0052_04)。
// 窓を動かす量は画面の座標(screenX / screenY)の差で決める。窓の中の座標は窓が動くとずれるため
function watchImagePointer(image: HTMLImageElement): { onImageHidden(): void } {
  const send = window.keycheer.sendPopupPointer;
  let isOver = false;
  let isDragging = false;
  image.addEventListener("pointerenter", () => {
    isOver = true;
    send({ type: "enter" });
  });
  image.addEventListener("pointerleave", () => {
    isOver = false;
    send({ type: "leave" });
  });
  image.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    isDragging = true;
    // 窓の外へポインタが出ても、離すまでこの絵に届けさせる
    image.setPointerCapture(event.pointerId);
    send({ type: "drag-start", screenX: event.screenX, screenY: event.screenY });
  });
  image.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    send({ type: "drag-move", screenX: event.screenX, screenY: event.screenY });
  });
  const endDrag = (event: PointerEvent): void => {
    if (!isDragging) return;
    isDragging = false;
    send({ type: "drag-end", screenX: event.screenX, screenY: event.screenY });
  };
  image.addEventListener("pointerup", endDrag);
  image.addEventListener("pointercancel", endDrag);
  return {
    // 絵の上にいるまま絵が消えると pointerleave が来ないことがあるので、ここで出たことにする
    onImageHidden() {
      isDragging = false;
      if (!isOver) return;
      isOver = false;
      send({ type: "leave" });
    },
  };
}

function main(): void {
  const root = document.getElementById("cheer-message");
  const messageArea = document.getElementById("message-area");
  const image = document.getElementById("character-image") as HTMLImageElement | null;
  if (root === null || messageArea === null || image === null) return;

  // S0052_01 絵は 128x192 に収めて描く / S0053_01 セリフは絵のすぐ下
  const layout = computePopupContentLayout();
  placeAt(image, layout.image);
  placeAt(messageArea, layout.message);
  const imagePointer = watchImagePointer(image);

  let state: PopupState = initialPopupState;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // S0053_03 収まらないセリフは文字を小さくして全部出す。吹き出しは領域(縦 64 × 横 192)を超えないので、
  // 中身の大きさ(scroll*)が領域に収まるかを、文字の大きさを変えながら測る
  const fitMessage = (): void => {
    if (state.text === "") return;
    const fontSizePx = computeMessageFontSizePx((size) => {
      root.style.fontSize = `${size}px`;
      return root.scrollHeight <= layout.message.height && root.scrollWidth <= layout.message.width;
    });
    root.style.fontSize = `${fontSizePx}px`;
  };

  let renderedImagePath: string | null = null;
  const render = (): void => {
    root.textContent = state.text;
    fitMessage();
    // 同じ画像なら読み直さない(切り替えのたびのちらつきを避ける)
    if (state.imagePath !== renderedImagePath) {
      renderedImagePath = state.imagePath;
      if (state.imagePath === null) image.removeAttribute("src");
      else image.src = buildImageUrl(state.imagePath);
    }
    image.hidden = state.imagePath === null;
    if (image.hidden) imagePointer.onImageHidden();
    document.body.classList.toggle("visible", state.visible);
  };

  // 待機画像・常時表示の切り替え(使用中のキャラクターや設定が変わるたびに届く)
  window.keycheer.onCharacterDisplay((display) => {
    state = applyCharacterDisplay(state, display);
    render();
  });

  window.keycheer.onCheerFired((payload) => {
    const update = showCheer(state, payload, Date.now());
    state = update.state;
    render();

    if (update.playWavPath !== null) {
      // 再生できなくても表示は続ける(wav 欠損時のフォールバックと同じ扱い)
      void new Audio(audioUrl(update.playWavPath)).play().catch(() => undefined);
    }

    // 上書き時は前の隠しタイマーを捨てて張り直す(キューに積まない)
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      state = tick(state, Date.now());
      render();
    }, payload.popupDurationMs);
  });

  render();
}

main();
