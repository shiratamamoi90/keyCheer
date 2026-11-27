// 総合(経路): 前の版の統計と設定を持つ JSON で起動 → 応援に要らない記録と止まったとみなす秒数が消える →
// 累計カウントの続きから数えて応援が出る → まとめ書きで累計カウントだけが保存される(論点 0080 / 0081)。
//
// 単体で既に縛った分岐(消すキーの一覧・消すものが無いときに保存し直さないこと)はここで再検査しない。
// ここが守るのは結合部の前提:起動の読み込み(store)が消したあとの累計カウントを runtime に渡し、
// runtime のまとめ書きが store の累計カウントへ足すこと。総合テストにシナリオ ID は付けない(N-2)。

import { describe, it, expect } from "vitest";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import { createCheerRuntime } from "../../src/main/cheerRuntime.js";
import type { CheerFiredPayload } from "../../src/core/shared/ipc.js";
import { ALL_BUCKET_KEYS, type MessagePool } from "../../src/core/messagePool.js";

const T0 = new Date(2026, 10, 27, 10, 0, 0).getTime();

function fakeStore(initial: Record<string, unknown>): StoreLike & { raw: Record<string, unknown> } {
  const raw: Record<string, unknown> = structuredClone(initial);
  return {
    raw,
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
    delete: ((key: string) => {
      delete raw[key];
    }) as StoreLike["delete"],
  };
}

// 応援はプールがあるときだけ出る(論点 0082)。ここでは文言を問わないので全バケットに 1 文ずつ入れる
function anyPool(): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((k) => [k, [{ id: `${k}-000`, text: "文" }]]),
  ) as MessagePool["buckets"];
  return { characterId: "char-1", version: 1, buckets };
}

describe("総合: 前の版の統計を持つ設定で起動しても、累計カウントだけを残して応援が続く", () => {
  it("removes the retired records on launch, continues from totalKeyCount and saves only it", () => {
    // GIVEN 前の版が保存した統計(応援履歴・日ごとの記録・アクティブ時間)と秒数の設定
    const raw = fakeStore({
      triggers: {
        regular: 50,
        milestoneInterval: 250,
        isMilestoneEnabled: true,
        activeThresholdSec: 60,
      },
      stats: {
        totalKeyCount: 249,
        totalActiveSeconds: 3600,
        dailyCounts: { "2026-11-26": 249 },
        dailyActiveSeconds: { "2026-11-26": 3600 },
        cheerHistory: [
          {
            timestamp: "2026-11-26T10:00:00.000Z",
            count: 200,
            kpm: 120,
            speedZone: "normal",
            type: "regular",
            timeOfDay: "morning",
            messageId: "baseline:normal_regular_morning-0",
            message: "いいペースだね!",
          },
        ],
      },
    });

    // WHEN main/index.ts と同じ順で起動する
    const store = createAppStore(raw);
    const { config } = store.loadTriggerConfig();
    const stats = store.loadStats();

    // THEN 起動の読み込みで、応援に要らない記録と秒数の設定が消えている
    expect(raw.raw.stats).toEqual({ totalKeyCount: 249 });
    expect(raw.raw.triggers).toEqual({
      regular: 50,
      milestoneInterval: 250,
      isMilestoneEnabled: true,
    });

    const emitted: CheerFiredPayload[] = [];
    const runtime = createCheerRuntime(
      {
        userDataDir: "/userdata",
        popupDurationMs: 5000,
        emitCheer: (payload) => emitted.push(payload),
        wavExists: () => false,
        recordKeyCount: (keys) => store.recordKeyCount(keys),
        random: () => 0,
      },
      config,
      { initialCount: stats.totalKeyCount },
    );
    runtime.setActiveCharacter("char-1", anyPool());

    // 累計 249 の続きから 51 回打つ:250 で節目、300 で通常の応援
    for (let i = 1; i <= 51; i++) runtime.handleKeyPress(T0 + i * 100);
    expect(emitted.map((p) => [p.count, p.type])).toEqual([
      [250, "milestone"],
      [300, "regular"],
    ]);

    // まとめ書きで保存されるのは累計カウントだけ(応援ごとの記録・日ごとの記録は作られない)
    runtime.flushStats();
    expect(raw.raw.stats).toEqual({ totalKeyCount: 300 });

    // 次の起動でも 300 の続きから数える
    expect(createAppStore(raw).loadStats()).toEqual({ totalKeyCount: 300 });
  });
});
