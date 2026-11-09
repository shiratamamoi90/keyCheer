// popupView: 応援ポップアップ(キャラの窓)の表示状態を決める純粋関数。DOM にも Electron にも触れない。
// spec: 論点 0017 / 論点 0036(キャラ画像の常時表示と切り替え)
// renderer は core を「使う側」。表示に必要な型は src/core/shared からのみ取る
// (core/providers・agent の生成系は import しない — 発動経路の不変条件)。

import type { CharacterDisplayPayload, CheerFiredPayload } from "../core/shared/ipc.js";

export interface PopupState {
  visible: boolean;
  text: string; // 表示文言({milestone} 補間済み)。入力内容は一切含まない。空 = 文言を出していない
  shownAt: number | null; // 応援の表示開始時刻(ms since epoch)。応援を出していなければ null
  durationMs: number; // この表示の持続時間
  imagePath: string | null; // いま描くキャラ画像。null = 画像を描かない
  idleImagePath: string | null; // 使用中のキャラクターの待機画像
  shouldAlwaysShow: boolean; // 常時表示(popup.shouldAlwaysShow)
}

// 窓の設定が届くまでは常時表示しない(論点 0017 の挙動)。起動時に main が CharacterDisplay を送る
export const initialPopupState: PopupState = {
  visible: false,
  text: "",
  shownAt: null,
  durationMs: 0,
  imagePath: null,
  idleImagePath: null,
  shouldAlwaysShow: false,
};

export interface PopupUpdate {
  state: PopupState;
  // 再生すべき wav。null = テキストのみ(baseline 定型文 / wav 欠損)
  playWavPath: string | null;
}

function isCheering(state: PopupState): boolean {
  return state.visible && state.shownAt !== null;
}

// S0036_18 常時表示なら待機画像を出し続ける / S0036_21 待機画像も無ければ画像を出さない
// S0036_23 使用中のキャラクターを切り替えたら待機画像も切り替わる / S0036_24 常時表示を切ると窓を出さない
// 応援を出している最中に届いたら、その応援は表示時間まで出し切る(文言を途中で消さない)。
export function applyCharacterDisplay(
  state: PopupState,
  display: CharacterDisplayPayload,
): PopupState {
  const next = {
    ...state,
    idleImagePath: display.idleImagePath,
    shouldAlwaysShow: display.shouldAlwaysShow,
  };
  if (!display.shouldAlwaysShow) {
    return { ...next, imagePath: null, visible: isCheering(state) };
  }
  if (isCheering(state)) return { ...next, imagePath: state.imagePath ?? display.idleImagePath };
  return { ...next, visible: true, imagePath: display.idleImagePath };
}

// シナリオ: 発動でポップアップが表示される / 表示中に次の発動が来たら上書きする
//   表示中でも新しい文言で上書きし、残り時間を popupDurationMs にリセットする(キューに積まない)。
// シナリオ: wav がある発動で音声も再生する / wav が無い発動はテキストのみ [異常系]
// S0036_19 応援でその応援種別の画像に切り替える / S0036_20 その画像が無ければ待機画像
// S0036_24 常時表示を切っているときは画像を描かない
export function showCheer(state: PopupState, payload: CheerFiredPayload, now: number): PopupUpdate {
  return {
    state: {
      ...state,
      visible: true,
      text: payload.message,
      shownAt: now,
      durationMs: payload.popupDurationMs,
      imagePath: state.shouldAlwaysShow ? (payload.imagePath ?? state.idleImagePath) : null,
    },
    playWavPath: payload.wavPath,
  };
}

// シナリオ: 表示時間が過ぎたら消える [境界]
//   表示中の条件は `経過 < durationMs`(strict less-than)。
//   docs/key-counter.md「閾値ちょうどは非アクティブ」と同じ向きに揃える。
// S0036_19 常時表示なら窓は消さず、文言を消して待機画像に戻す
export function tick(state: PopupState, now: number): PopupState {
  if (!isCheering(state) || state.shownAt === null) return state;
  if (now - state.shownAt < state.durationMs) return state;
  if (state.shouldAlwaysShow) {
    return { ...state, text: "", shownAt: null, imagePath: state.idleImagePath };
  }
  return { ...state, visible: false };
}
