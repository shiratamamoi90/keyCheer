// 総合(経路): キャラクターを作っていない状態で起動 → 打っても応援は出ず、キーは数えて保存される →
// プールのあるキャラクターを保存して使用中にする → 続きの回数から、そのプールの文言で応援が出る(論点 0082)。
//
// 単体で既に縛った分岐(プールが無いときに連続回避を変えないこと・解決の 3 つの場合)はここで再検査しない。
// ここが守るのは結合部の前提:起動の解決(characterSelection)が返す「プール無し」が runtime に届いて応援を止め、
// 切り替え(activateCharacter)が runtime に渡したプールで、累計カウントの続きから応援が出ること。
// 総合テストにシナリオ ID は付けない(N-2)。

import { describe, it, expect } from "vitest";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import { createCheerRuntime } from "../../src/main/cheerRuntime.js";
import { activateCharacter, loadActiveCharacterPool } from "../../src/main/characterSelection.js";
import { ALL_BUCKET_KEYS, type MessagePool } from "../../src/core/messagePool.js";
import type { CheerFiredPayload } from "../../src/core/shared/ipc.js";

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

function poolOf(characterId: string): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((key) => [key, [{ id: `${key}-000`, text: "チアの応援" }]]),
  ) as MessagePool["buckets"];
  return { characterId, version: 1, buckets };
}

describe("総合: 使用中のキャラクターが無い間は応援を出さず、使用中にすると続きから出る", () => {
  it("stays silent without an active character, keeps counting, then cheers from the pool after activation", () => {
    // GIVEN キャラクターを作っていない状態(main/index.ts と同じ順で起動する)
    const raw = fakeStore({
      triggers: { regular: 50, milestoneInterval: 250, isMilestoneEnabled: true },
    });
    const store = createAppStore(raw);
    const { config } = store.loadTriggerConfig();
    const pools = new Map<string, MessagePool>();
    const loadPool = (id: string) => pools.get(id) ?? null;

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
      { initialCount: store.loadStats().totalKeyCount },
    );
    const active = loadActiveCharacterPool({ store, loadPool });
    runtime.setActiveCharacter(active?.characterId ?? null, active?.pool ?? null);

    // WHEN 累計 60 まで打つ(累計 50 は応援の回数)
    for (let i = 1; i <= 60; i++) runtime.handleKeyPress(T0 + i * 100);
    runtime.flushStats();

    // THEN 応援は出ないが、キーは数えて保存されている
    expect(emitted).toEqual([]);
    expect(store.loadStats()).toEqual({ totalKeyCount: 60 });

    // WHEN キャラクターを保存し、生成したプールがある状態で使用中にして、累計 100 まで打つ
    const added = store.addCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 });
    if (!added.ok) throw new Error("キャラクターを保存できなかった");
    pools.set(added.id, poolOf(added.id));
    const result = activateCharacter(
      {
        store,
        loadPool,
        generation: { isGenerating: () => false },
        onActiveCharacterChanged: (id, pool) => runtime.setActiveCharacter(id, pool),
      },
      added.id,
    );
    for (let i = 61; i <= 100; i++) runtime.handleKeyPress(T0 + i * 100);
    runtime.flushStats();

    // THEN 累計 100 の 1 回だけ、そのプールの文言で出る(出さなかった累計 50 の分はまとめて出さない)
    expect(result).toEqual({ ok: true });
    expect(emitted.map((p) => [p.count, p.message])).toEqual([[100, "チアの応援"]]);
    expect(store.loadStats()).toEqual({ totalKeyCount: 100 });
  });
});
