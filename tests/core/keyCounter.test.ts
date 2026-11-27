import { describe, it, expect } from "vitest";
import { recordKeyPress, initialKeyCounterState } from "../../src/core/keyCounter.js";

describe("key-counter / recordKeyPress", () => {
  it("S0011_01 キー押下でカウント加算: increments count on each event (first press)", () => {
    // GIVEN initial state
    // WHEN press
    // THEN count=1(押されたキーの種類・内容は状態に持たない)
    const next = recordKeyPress(initialKeyCounterState);
    expect(next).toEqual({ count: 1 });
  });

  it("S0011_02 同時押し・複数キーもそれぞれ1カウント: counts each event for simultaneous keys", () => {
    // GIVEN 同時に 2 イベント発生
    let s = recordKeyPress(initialKeyCounterState);
    s = recordKeyPress(s);
    expect(s.count).toBe(2);
  });

  it("S0011_03 キーリピート(押しっぱなし): counts OS auto-repeat as raw events (no debounce)", () => {
    // GIVEN OS リピートが 10 件高速発火
    let s = initialKeyCounterState;
    for (let i = 0; i < 10; i++) s = recordKeyPress(s);
    expect(s.count).toBe(10);
  });

  it("does not mutate the given state", () => {
    const state = { count: 5 };
    recordKeyPress(state);
    expect(state).toEqual({ count: 5 });
  });
});
