// popup: 応援ポップアップの描画エントリ。表示判断は popupView(純粋関数)に委譲する。
// spec: 論点 0017
// この層は DOM 操作と音声再生だけを行う I/O グルー — テスト対象外(popupView 側で縛る)。
// core / providers / agent は import しない(発動経路の不変条件。ESLint で強制)。

import { initialPopupState, showCheer, tick, type PopupState } from "./popupView.js";
import type { KeyCheerApi } from "../preload/api.js";

declare global {
  interface Window {
    keycheer: KeyCheerApi;
  }
}

// wav は file:// を直接開かず、main が登録した専用スキーム経由で読む(spec 確定事項 #4)。
const AUDIO_SCHEME = "keycheer-audio";

function audioUrl(wavPath: string): string {
  return `${AUDIO_SCHEME}://play/${encodeURIComponent(wavPath)}`;
}

function main(): void {
  const root = document.getElementById("cheer-message");
  if (root === null) return;

  let state: PopupState = initialPopupState;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = (): void => {
    root.textContent = state.text;
    document.body.classList.toggle("visible", state.visible);
  };

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
