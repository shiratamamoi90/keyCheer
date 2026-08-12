// popupView: 応援ポップアップの表示状態を決める純粋関数。DOM にも Electron にも触れない。
// spec: 論点 0017
// renderer は core を「使う側」。表示に必要な型は src/core/shared からのみ取る
// (core/providers・agent の生成系は import しない — 発動経路の不変条件)。

import type { CheerFiredPayload } from "../core/shared/ipc.js";

export interface PopupState {
  visible: boolean;
  text: string; // 表示文言({milestone} 補間済み)。入力内容は一切含まない
  shownAt: number | null; // 表示開始時刻(ms since epoch)
  durationMs: number; // この表示の持続時間
}

export const initialPopupState: PopupState = {
  visible: false,
  text: "",
  shownAt: null,
  durationMs: 0,
};

export interface PopupUpdate {
  state: PopupState;
  // 再生すべき wav。null = テキストのみ(baseline 定型文 / wav 欠損)
  playWavPath: string | null;
}

// シナリオ: 発動でポップアップが表示される / 表示中に次の発動が来たら上書きする
//   表示中でも新しい文言で上書きし、残り時間を popupDurationMs にリセットする(キューに積まない)。
// シナリオ: wav がある発動で音声も再生する / wav が無い発動はテキストのみ [異常系]
export function showCheer(
  _state: PopupState,
  payload: CheerFiredPayload,
  now: number,
): PopupUpdate {
  return {
    state: {
      visible: true,
      text: payload.message,
      shownAt: now,
      durationMs: payload.popupDurationMs,
    },
    playWavPath: payload.wavPath,
  };
}

// シナリオ: 表示時間が過ぎたら消える [境界]
//   表示中の条件は `経過 < durationMs`(strict less-than)。
//   docs/key-counter.md「閾値ちょうどは非アクティブ」と同じ向きに揃える。
export function tick(state: PopupState, now: number): PopupState {
  if (!state.visible || state.shownAt === null) return state;
  if (now - state.shownAt < state.durationMs) return state;
  return { ...state, visible: false };
}
