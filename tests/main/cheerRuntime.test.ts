// main/cheerRuntime: 発動経路のグルー(engine の合成 + wav 解決 + 履歴記録)。
// spec: specs/cheer-trigger.md(通常/マイルストーン発動・履歴の記録・wav 欠損フォールバック)
//       specs/key-counter.md(累計カウント・アクティブ秒数の累積)
// 依存(時刻・乱数・fs・IPC・store)はすべて注入されるため決定的にテストできる。

import { describe, it, expect } from "vitest";
import {
  createCheerRuntime,
  type CheerRuntimeDeps,
  type StatsDelta,
} from "../../src/main/cheerRuntime.js";
import type { CheerFiredPayload } from "../../src/shared/ipc.js";
import type { CheerHistoryEntry, TriggerConfig } from "../../src/shared/types.js";

const CONFIG: TriggerConfig = {
  regular: 50,
  milestones: [1000, 5000],
  activeThresholdSec: 60,
};

interface Harness {
  deps: CheerRuntimeDeps;
  emitted: CheerFiredPayload[];
  history: CheerHistoryEntry[];
}

function harness(overrides: Partial<CheerRuntimeDeps> = {}): Harness {
  const emitted: CheerFiredPayload[] = [];
  const history: CheerHistoryEntry[] = [];
  const deps: CheerRuntimeDeps = {
    userDataDir: "/userData",
    popupDurationMs: 5000,
    emitCheer: (payload) => emitted.push(payload),
    recordHistory: (entry) => history.push(entry),
    wavExists: () => true,
    random: () => 0,
    ...overrides,
  };
  return { deps, emitted, history };
}

// 2026-07-25 10:00:00 ローカル時刻(morning)
const T0 = new Date(2026, 6, 25, 10, 0, 0).getTime();

describe("cheerRuntime / 通常応援を N 回ごとに発動", () => {
  it("fires at a multiple of triggers.regular and emits a popup payload", () => {
    const { deps, emitted } = harness();
    const runtime = createCheerRuntime(deps, CONFIG);
    for (let i = 1; i <= 50; i++) runtime.handleKeyPress(T0 + i);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.count).toBe(50);
    expect(emitted[0]?.type).toBe("regular");
    expect(emitted[0]?.timeOfDay).toBe("morning");
    expect(emitted[0]?.popupDurationMs).toBe(5000);
  });

  it("キャラ未作成時の発動: baseline selections carry no wav path", () => {
    const { deps, emitted } = harness();
    const runtime = createCheerRuntime(deps, CONFIG);
    for (let i = 1; i <= 50; i++) runtime.handleKeyPress(T0 + i);
    expect(emitted[0]?.messageId.startsWith("baseline:")).toBe(true);
    expect(emitted[0]?.wavPath).toBeNull();
  });
});

describe("cheerRuntime / 累計カウントからの再開", () => {
  it("累計カウントが triggers.regular の倍数: seeds the counter from persisted totalKeyCount", () => {
    // GIVEN 前回終了時までの累計 999(specs/cheer-trigger.md は「累計カウント」で判定する)
    const { deps, emitted } = harness();
    const runtime = createCheerRuntime(deps, CONFIG, { initialCount: 999 });

    // WHEN 再起動後に 1 打
    runtime.handleKeyPress(T0);

    // THEN 累計 1000 = マイルストーン発動(セッション内カウント 1 ではない)
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.count).toBe(1000);
    expect(emitted[0]?.type).toBe("milestone");
  });

  it("履歴の記録: cheerHistory entries carry the cumulative count", () => {
    const { deps, history } = harness();
    const runtime = createCheerRuntime(deps, CONFIG, { initialCount: 149 });
    runtime.handleKeyPress(T0);
    expect(history).toHaveLength(1);
    expect(history[0]?.count).toBe(150);
    expect(history[0]?.type).toBe("regular");
    expect(history[0]?.timestamp).toBe(new Date(T0).toISOString());
  });
});

describe("cheerRuntime / 統計の書き込みはバッファして定期的に flush する", () => {
  function statsHarness() {
    const writes: StatsDelta[] = [];
    const { deps } = harness({ recordStats: (s) => writes.push(s) });
    return { writes, runtime: createCheerRuntime(deps, CONFIG) };
  }

  it("カウンタはメモリ上で加算する: does not write to the store on every key press", () => {
    const { writes, runtime } = statsHarness();
    for (let i = 1; i <= 30; i++) runtime.handleKeyPress(T0 + i * 100);
    expect(writes).toHaveLength(0);
  });

  it("アクティブ秒数の累積: flush writes the buffered key count and whole active seconds", () => {
    const { writes, runtime } = statsHarness();
    runtime.handleKeyPress(T0);
    runtime.handleKeyPress(T0 + 500);
    runtime.handleKeyPress(T0 + 1_500);
    runtime.flushStats();

    expect(writes).toHaveLength(1);
    expect(writes[0]?.keys).toBe(3);
    // 初回は加算なし + 500ms + 1000ms = 1500ms → 1 秒(端数 500ms は次回へ繰り越す)
    expect(writes[0]?.activeSeconds).toBe(1);
  });

  it("端数を切り捨てず次の flush へ繰り越す(累計がずれない)", () => {
    const { writes, runtime } = statsHarness();
    runtime.handleKeyPress(T0);
    runtime.handleKeyPress(T0 + 1_500); // +1500ms
    runtime.flushStats(); // 1 秒(繰り越し 500ms)
    runtime.handleKeyPress(T0 + 2_000); // +500ms → 繰り越しと合わせて 1000ms
    runtime.flushStats(); // 1 秒

    expect(writes.map((w) => w.activeSeconds)).toEqual([1, 1]);
  });

  it("当日キーはローカル日付: buckets stats by local calendar day, not UTC", () => {
    const { writes, runtime } = statsHarness();
    // ローカル 2026-07-25 23:30(UTC 基準だと翌日に落ちる時刻帯)
    runtime.handleKeyPress(new Date(2026, 6, 25, 23, 30, 0).getTime());
    runtime.flushStats();
    expect(writes[0]?.day).toBe("2026-07-25");
  });

  it("flush 後はバッファが空になる(二重計上しない)", () => {
    const { writes, runtime } = statsHarness();
    runtime.handleKeyPress(T0);
    runtime.flushStats();
    runtime.flushStats();
    expect(writes).toHaveLength(1);
  });

  it("日付をまたいだら日ごとに分けて flush する [境界]", () => {
    const { writes, runtime } = statsHarness();
    runtime.handleKeyPress(new Date(2026, 6, 25, 23, 59, 59).getTime());
    runtime.handleKeyPress(new Date(2026, 6, 26, 0, 0, 1).getTime());
    runtime.flushStats();

    const byDay = Object.fromEntries(writes.map((w) => [w.day, w.keys]));
    expect(byDay).toEqual({ "2026-07-25": 1, "2026-07-26": 1 });
  });
});

describe("cheerRuntime / 音声ファイル欠損時のフォールバック [異常系]", () => {
  it("falls back to a text-only popup when the wav is missing", () => {
    const { deps, emitted } = harness({ wavExists: () => false });
    const runtime = createCheerRuntime(deps, CONFIG, { initialCount: 49 });
    runtime.setActiveCharacter("chia", {
      characterId: "chia",
      version: 1,
      buckets: {
        normal_regular_morning: [{ id: "m001", text: "いいペースだね!" }],
      } as never,
    });
    runtime.handleKeyPress(T0);
    expect(emitted[0]?.message).toBe("いいペースだね!");
    expect(emitted[0]?.wavPath).toBeNull();
  });

  it("プールからの 1 文選択 + 対応 wav 再生: resolves the wav path when present", () => {
    const { deps, emitted } = harness({ wavExists: () => true });
    const runtime = createCheerRuntime(deps, CONFIG, { initialCount: 49 });
    runtime.setActiveCharacter("chia", {
      characterId: "chia",
      version: 1,
      buckets: {
        normal_regular_morning: [{ id: "m001", text: "いいペースだね!" }],
      } as never,
    });
    runtime.handleKeyPress(T0);
    expect(emitted[0]?.wavPath).toBe("/userData/characters/chia/voices/m001.wav");
  });
});

describe("cheerRuntime / 設定変更の即時反映", () => {
  it("uses the new interval from the next key press (再起動不要)", () => {
    const { deps, emitted } = harness();
    const runtime = createCheerRuntime(deps, CONFIG, { initialCount: 9 });
    runtime.setConfig({ ...CONFIG, regular: 10 });
    runtime.handleKeyPress(T0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.count).toBe(10);
  });
});

// spec: specs/pool-generation.md
//   「起動時にプールを読み込んで応援に使う」「キャラ未作成なら baseline で応援する」
//   「生成直後は再起動なしで応援に反映される」
// setActiveCharacter に渡す実データが揃ったのが changes/0011。ここでは
// 「プールを渡すと発動内容が baseline から切り替わる」ことを固定する。
import { ALL_BUCKET_KEYS, type MessagePool } from "../../src/engine/messagePool.js";

function poolWith(text: string): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((k) => [k, [{ id: `${k}-000`, text }]]),
  ) as MessagePool["buckets"];
  return { characterId: "char-1", version: 1, buckets };
}

function fireOnce(runtime: ReturnType<typeof createCheerRuntime>): void {
  let now = T0;
  for (let i = 0; i < CONFIG.regular; i += 1) {
    runtime.handleKeyPress(now);
    now += 100;
  }
}

describe("cheerRuntime / キャラ未作成なら baseline で応援する", () => {
  it("emits a baseline message with no wav", () => {
    const h = harness();
    const runtime = createCheerRuntime(h.deps, CONFIG);
    runtime.setActiveCharacter(null, null);

    fireOnce(runtime);

    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]!.wavPath).toBeNull();
    // baseline 定型文の ID は "baseline:" 接頭辞を持つ(specs/data-model.md)
    expect(h.history[0]!.messageId).toMatch(/^baseline:/);
  });
});

describe("cheerRuntime / 起動時にプールを読み込んで応援に使う", () => {
  it("emits the pool text and resolves a wav path", () => {
    const h = harness();
    const runtime = createCheerRuntime(h.deps, CONFIG);
    runtime.setActiveCharacter("char-1", poolWith("プールの文言"));

    fireOnce(runtime);

    expect(h.emitted[0]!.message).toBe("プールの文言");
    expect(h.emitted[0]!.wavPath).toContain("/userData/characters/char-1/voices/");
    expect(h.history[0]!.messageId).not.toMatch(/^baseline:/);
  });

  it("falls back to text only when the wav is missing", () => {
    const h = harness({ wavExists: () => false });
    const runtime = createCheerRuntime(h.deps, CONFIG);
    runtime.setActiveCharacter("char-1", poolWith("プールの文言"));

    fireOnce(runtime);

    expect(h.emitted[0]!.message).toBe("プールの文言");
    expect(h.emitted[0]!.wavPath).toBeNull();
  });
});

describe("cheerRuntime / 生成直後は再起動なしで応援に反映される", () => {
  it("switches from baseline to the pool without recreating the runtime", () => {
    const h = harness();
    const runtime = createCheerRuntime(h.deps, CONFIG);
    runtime.setActiveCharacter(null, null);
    fireOnce(runtime);
    const baselineMessage = h.emitted[0]!.message;

    // 生成完了 → onPoolReady 相当
    runtime.setActiveCharacter("char-1", poolWith("生成された文言"));
    fireOnce(runtime);

    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1]!.message).toBe("生成された文言");
    expect(h.emitted[1]!.message).not.toBe(baselineMessage);
    expect(h.emitted[1]!.wavPath).not.toBeNull();
  });
});
