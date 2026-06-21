import { describe, it, expect } from "vitest";
import {
  isActive,
  recordKeyPress,
  initialKeyCounterState,
  type KeyCounterState,
} from "../../src/engine/keyCounter.js";

describe("key-counter / isActive", () => {
  it("returns false when no key has been pressed yet", () => {
    // GIVEN lastKeyTimestamp = null
    expect(isActive(null, 1_000, 60)).toBe(false);
  });

  it("treats keys within threshold as active", () => {
    // GIVEN last=1000, threshold=60s, now=last+59s
    expect(isActive(1_000, 1_000 + 59_000, 60)).toBe(true);
  });

  it("ends session at threshold boundary (strict less-than)", () => {
    // GIVEN 閾値ちょうど = 非アクティブ
    expect(isActive(1_000, 1_000 + 60_000, 60)).toBe(false);
  });

  it("ends session past threshold", () => {
    expect(isActive(1_000, 1_000 + 61_000, 60)).toBe(false);
  });

  it("responds to threshold changes (60 -> 120)", () => {
    // GIVEN activeThresholdSec = 120
    // WHEN now = last + 90s
    expect(isActive(1_000, 1_000 + 90_000, 120)).toBe(true);
    expect(isActive(1_000, 1_000 + 90_000, 60)).toBe(false);
  });
});

describe("key-counter / recordKeyPress", () => {
  const at = (
    count: number,
    lastKeyTimestamp: number | null,
    activeMs: number,
  ): KeyCounterState => ({
    count,
    lastKeyTimestamp,
    activeMs,
  });

  it("increments count on each event (first press)", () => {
    // GIVEN initial state
    // WHEN press at t=1000
    // THEN count=1, lastKey=1000, activeMs=0(初回はギャップなし)
    const next = recordKeyPress(initialKeyCounterState, 1_000, 60);
    expect(next).toEqual(at(1, 1_000, 0));
  });

  it("counts each event for simultaneous keys", () => {
    // GIVEN 同時に 2 イベント発生(同 timestamp)
    let s = recordKeyPress(initialKeyCounterState, 1_000, 60);
    s = recordKeyPress(s, 1_000, 60);
    expect(s.count).toBe(2);
    // 同 timestamp なら activeMs 増加 0
    expect(s.activeMs).toBe(0);
  });

  it("counts OS auto-repeat as raw events (no debounce)", () => {
    // GIVEN OS リピートが 10 件高速発火
    let s = initialKeyCounterState;
    for (let i = 0; i < 10; i++) {
      s = recordKeyPress(s, 1_000 + i * 30, 60); // 30ms 間隔
    }
    expect(s.count).toBe(10);
  });

  it("accumulates active duration between consecutive in-threshold keys", () => {
    // GIVEN 1000ms 間隔で 3 連続押下、threshold=60s → 全部アクティブ継続
    let s = recordKeyPress(initialKeyCounterState, 1_000, 60); // first: +0
    s = recordKeyPress(s, 1_500, 60); // +500ms
    s = recordKeyPress(s, 2_500, 60); // +1000ms
    expect(s.activeMs).toBe(1_500);
    expect(s.count).toBe(3);
    expect(s.lastKeyTimestamp).toBe(2_500);
  });

  it("does not accumulate across idle gap (post-idle keypress resets active accumulation)", () => {
    // GIVEN 押下 → 60s 以上 idle → 押下
    let s = recordKeyPress(initialKeyCounterState, 1_000, 60); // +0
    s = recordKeyPress(s, 1_000 + 60_000, 60); // ちょうど閾値 = 非アクティブ判定 = 加算しない
    expect(s.activeMs).toBe(0);
    s = recordKeyPress(s, 1_000 + 60_000 + 500, 60); // 直後の継続 = +500
    expect(s.activeMs).toBe(500);
  });

  it("does not accumulate for the very first key (no prior timestamp)", () => {
    const s = recordKeyPress(initialKeyCounterState, 5_000, 60);
    expect(s.activeMs).toBe(0);
  });
});
