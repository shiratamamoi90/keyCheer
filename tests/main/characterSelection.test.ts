// main/characterSelection: 使用中のキャラクターの切り替えと、起動時の使用中のプールの解決。
// 要件: docs/character-selection.md(論点 0032)
// store は StoreLike の偽物、プールの読み出しと生成の状態は偽物で注入する。

import { describe, it, expect, vi } from "vitest";
import {
  activateCharacter,
  loadActiveCharacterPool,
  loadCharacterList,
} from "../../src/main/characterSelection.js";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import { ALL_BUCKET_KEYS, type MessagePool } from "../../src/core/messagePool.js";

function savedCharacter(id: string) {
  return { id, name: `名前-${id}`, personality: "元気", imagePaths: {}, voicevoxSpeakerId: 3 };
}

function fakeStore(initial: Record<string, unknown>): StoreLike & { raw: Record<string, unknown> } {
  const raw: Record<string, unknown> = { ...initial };
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
    ALL_BUCKET_KEYS.map((key) => [key, [{ id: `${key}-000`, text: `${characterId}の応援` }]]),
  ) as MessagePool["buckets"];
  return { characterId, version: 1, buckets };
}

// C(プールあり)・D(プールあり)・E(プール無し)を保存した状態から始める
function setup(
  over: { activeCharacterId?: string; generatingId?: string; extra?: Record<string, unknown> } = {},
) {
  const backing = fakeStore({
    characters: [savedCharacter("char-c"), savedCharacter("char-d"), savedCharacter("char-e")],
    ...(over.activeCharacterId !== undefined ? { activeCharacterId: over.activeCharacterId } : {}),
    ...over.extra,
  });
  const store = createAppStore(backing);
  const generation = {
    isGenerating: (id: string) => id === over.generatingId,
    cancel: vi.fn(),
  };
  const onActiveCharacterChanged = vi.fn();
  const deps = {
    store,
    loadPool: (id: string) => (id === "char-e" ? null : poolOf(id)),
    generation,
    onActiveCharacterChanged,
  };
  return { backing, store, generation, onActiveCharacterChanged, deps };
}

describe("characterSelection / 生成済みのキャラクターを使用中にする", () => {
  it("S0032_11 saves activeCharacterId and hands the pool to the cheer path", () => {
    const { store, onActiveCharacterChanged, deps } = setup({ activeCharacterId: "char-d" });

    const activated = activateCharacter(deps, "char-c");

    expect(activated).toEqual({ ok: true });
    expect(store.loadActiveCharacterId()).toBe("char-c");
    // 次の応援から再起動なしで C のプールを使う
    expect(onActiveCharacterChanged).toHaveBeenCalledWith("char-c", poolOf("char-c"));
  });
});

describe("characterSelection / プールの無いキャラクターは使用中にできない [否定]", () => {
  it("S0032_12 refuses a character without a pool and keeps activeCharacterId", () => {
    const { store, onActiveCharacterChanged, deps } = setup({ activeCharacterId: "char-d" });

    const activated = activateCharacter(deps, "char-e");

    expect(activated).toEqual({ ok: false, reason: "no-pool" });
    expect(store.loadActiveCharacterId()).toBe("char-d");
    expect(onActiveCharacterChanged).not.toHaveBeenCalled();
  });
});

describe("characterSelection / 生成中のキャラクターは使用中にできない [否定]", () => {
  it("S0032_13 refuses a generating character even when it has a previous pool", () => {
    const { store, onActiveCharacterChanged, deps } = setup({
      activeCharacterId: "char-d",
      generatingId: "char-c",
    });

    const activated = activateCharacter(deps, "char-c");

    expect(activated).toEqual({ ok: false, reason: "generating" });
    expect(store.loadActiveCharacterId()).toBe("char-d");
    expect(onActiveCharacterChanged).not.toHaveBeenCalled();
  });
});

describe("characterSelection / 生成中でも他のキャラクターに切り替えられる", () => {
  it("S0032_14 switches to another character without cancelling the running generation", () => {
    const { store, generation, deps } = setup({ generatingId: "char-c" });

    const activated = activateCharacter(deps, "char-d");

    expect(activated).toEqual({ ok: true });
    expect(store.loadActiveCharacterId()).toBe("char-d");
    expect(generation.cancel).not.toHaveBeenCalled();
  });
});

describe("characterSelection / 使用中のキャラクターが無ければ定型文で応援する [境界]", () => {
  it("S0032_15 resolves no pool when the active character is unset, missing or has no pool", () => {
    const unset = setup();
    const missing = setup({ activeCharacterId: "char-gone" });
    const noPool = setup({ activeCharacterId: "char-e" });

    expect(loadActiveCharacterPool(unset.deps)).toBeNull();
    expect(loadActiveCharacterPool(missing.deps)).toBeNull();
    expect(loadActiveCharacterPool(noPool.deps)).toBeNull();
    // 保存値は書き換えない
    expect(missing.backing.raw.activeCharacterId).toBe("char-gone");
    expect(noPool.backing.raw.activeCharacterId).toBe("char-e");
  });
});

describe("characterSelection / 切り替えは統計とトリガー設定を変えない [否定]", () => {
  it("S0032_16 leaves stats and trigger settings unchanged", () => {
    const stats = { totalKeyCount: 1234, dailyCounts: { "2026-10-31": 34 }, cheerHistory: [] };
    const triggers = { regular: 70, milestones: [1000], activeThresholdSec: 30 };
    const { backing, deps } = setup({ activeCharacterId: "char-c", extra: { stats, triggers } });

    activateCharacter(deps, "char-d");

    expect(backing.raw.stats).toEqual({
      totalKeyCount: 1234,
      dailyCounts: { "2026-10-31": 34 },
      cheerHistory: [],
    });
    expect(backing.raw.triggers).toEqual({
      regular: 70,
      milestones: [1000],
      activeThresholdSec: 30,
    });
  });
});

describe("characterSelection / renderer からの切り替え要求は main 側で検証する [不変条件]", () => {
  it("S0032_17 rejects a non-string id and an id that is not in characters", () => {
    const { store, onActiveCharacterChanged, deps } = setup({ activeCharacterId: "char-d" });

    expect(activateCharacter(deps, 42)).toEqual({ ok: false, reason: "invalid-request" });
    expect(activateCharacter(deps, { id: "char-c" })).toEqual({
      ok: false,
      reason: "invalid-request",
    });
    expect(activateCharacter(deps, "char-gone")).toEqual({ ok: false, reason: "not-found" });
    expect(store.loadActiveCharacterId()).toBe("char-d");
    expect(onActiveCharacterChanged).not.toHaveBeenCalled();
  });
});

// renderer に渡すキャラクターの一覧(論点 0033 の画面が使う)。画面ごとの選別は renderer 側
// (renderer/mainScreen.ts)。ここでは main が持つ事実(プール・生成中・使用中・生成後の変更)を載せることだけを縛る。
describe("characterSelection / 画面に渡すキャラクターの一覧", () => {
  it("carries the pool, generating, active and profile-changed facts for every character", () => {
    const { deps } = setup({ activeCharacterId: "char-d", generatingId: "char-c" });

    const list = loadCharacterList({
      ...deps,
      loadGeneratedProfile: (id: string) =>
        id === "char-d"
          ? { name: "生成時の名前", personality: "元気", voicevoxSpeakerId: 3 }
          : undefined,
    });

    expect(list).toEqual([
      {
        id: "char-c",
        name: "名前-char-c",
        personality: "元気",
        voicevoxSpeakerId: 3,
        hasPool: true,
        isGenerating: true,
        isActive: false,
        hasProfileChanged: false,
      },
      {
        id: "char-d",
        name: "名前-char-d",
        personality: "元気",
        voicevoxSpeakerId: 3,
        hasPool: true,
        isGenerating: false,
        isActive: true,
        hasProfileChanged: true,
      },
      {
        id: "char-e",
        name: "名前-char-e",
        personality: "元気",
        voicevoxSpeakerId: 3,
        hasPool: false,
        isGenerating: false,
        isActive: false,
        hasProfileChanged: false,
      },
    ]);
  });
});
