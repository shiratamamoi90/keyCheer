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
import { AUDIO_SCHEME } from "../core/shared/ipc.js";
import type { KeyCheerApi } from "../preload/api.js";

declare global {
  interface Window {
    keycheer: KeyCheerApi;
  }
}

// wav は file:// を直接開かず、main が登録した専用スキーム経由で読む(spec 確定事項 #4)。
// スキーム名は core/shared/ipc.ts が正本(main 側と同じ値を参照する)。

function audioUrl(wavPath: string): string {
  return `${AUDIO_SCHEME}://play/${encodeURIComponent(wavPath)}`;
}

// キャラ画像も同じ専用スキームで読む(論点 0036。main は .png だけを許す)
function imageUrl(imagePath: string): string {
  return `${AUDIO_SCHEME}://image/${encodeURIComponent(imagePath)}`;
}

function main(): void {
  const root = document.getElementById("cheer-message");
  const image = document.getElementById("character-image") as HTMLImageElement | null;
  if (root === null || image === null) return;

  let state: PopupState = initialPopupState;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let renderedImagePath: string | null = null;
  const render = (): void => {
    root.textContent = state.text;
    // 同じ画像なら読み直さない(切り替えのたびのちらつきを避ける)
    if (state.imagePath !== renderedImagePath) {
      renderedImagePath = state.imagePath;
      if (state.imagePath === null) image.removeAttribute("src");
      else image.src = imageUrl(state.imagePath);
    }
    image.hidden = state.imagePath === null;
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
