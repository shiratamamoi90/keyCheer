// key-counter: キー押下のカウント・最終押下時刻・累計アクティブ時間。
// spec: specs/key-counter.md(全シナリオに対応)
// 純粋関数のみ。電源・I/O・electron-store を持たない。

export interface KeyCounterState {
  count: number;
  lastKeyTimestamp: number | null; // ms since epoch
  activeMs: number; // 累計アクティブ時間(ms)
}

export const initialKeyCounterState: KeyCounterState = {
  count: 0,
  lastKeyTimestamp: null,
  activeMs: 0,
};

// シナリオ: アクティブ判定 / 閾値ちょうどは非アクティブ / 閾値変更後の判定
export function isActive(
  lastKeyTimestamp: number | null,
  now: number,
  thresholdSec: number,
): boolean {
  if (lastKeyTimestamp === null) return false;
  return now - lastKeyTimestamp < thresholdSec * 1000;
}

// シナリオ: キー押下でカウント加算 / 同時押し / リピート生イベント / アクティブ秒数の累積
export function recordKeyPress(
  state: KeyCounterState,
  now: number,
  thresholdSec: number,
): KeyCounterState {
  const wasActive = isActive(state.lastKeyTimestamp, now, thresholdSec);
  const gapMs = wasActive && state.lastKeyTimestamp !== null ? now - state.lastKeyTimestamp : 0;
  return {
    count: state.count + 1,
    lastKeyTimestamp: now,
    activeMs: state.activeMs + gapMs,
  };
}
