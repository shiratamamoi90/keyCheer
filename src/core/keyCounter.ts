// key-counter: キー押下のカウント(累計カウント)。
// 要件: docs/key-counter.md(全シナリオに対応)
// 純粋関数のみ。電源・I/O・electron-store を持たない。
//
// 最後の押下時刻とアクティブ時間は持たない(論点 0081)。応援の発動に要るのは累計カウントだけで、
// KPM は runtime の 60 秒窓のタイムスタンプで数える(speed-zone.md)。

export interface KeyCounterState {
  count: number;
}

export const initialKeyCounterState: KeyCounterState = {
  count: 0,
};

// シナリオ: キー押下でカウント加算 / 同時押し / リピート生イベント
export function recordKeyPress(state: KeyCounterState): KeyCounterState {
  return { count: state.count + 1 };
}
