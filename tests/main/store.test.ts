// main/store: 設定の読み込み・マイグレーション・統計追記の契約。
// 要件: docs/data-model.md「既存設定の読み込みと既定値補完」/「triggers.regular = 100 のマイグレーション [境界]」
// electron-store は StoreLike で注入できるため、main 層でもここは決定的にテストできる。

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import {
  DEFAULT_TRIGGER_CONFIG,
  EMPTY_STATS,
  DEFAULT_ONBOARDING,
  DEFAULT_SYSTEM_CONFIG,
} from "../../src/core/shared/types.js";

function fakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
} {
  const raw: Record<string, unknown> = { triggers: undefined, stats: undefined, ...initial };
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

describe("store / 既存設定の読み込みと既定値補完", () => {
  it("S0015_01 fills missing keys with defaults (旧バージョン JSON)", () => {
    const store = createAppStore(fakeStore({ triggers: { regular: 75 } }));
    const { config, migrated } = store.loadTriggerConfig();
    expect(config.regular).toBe(75);
    expect(config.milestones).toEqual(DEFAULT_TRIGGER_CONFIG.milestones);
    expect(config.activeThresholdSec).toBe(60);
    expect(migrated).toBe(false);
  });

  it("replaces invalid values with defaults (JSON 直接編集への防御)", () => {
    const store = createAppStore(fakeStore({ triggers: { regular: -1, milestones: "x" } }));
    const { config } = store.loadTriggerConfig();
    expect(config).toEqual(DEFAULT_TRIGGER_CONFIG);
  });
});

describe("store / `triggers.regular = 100` のマイグレーション [境界]", () => {
  it("S0015_02 resets the legacy default 100 to 50 and flags migrated on first launch", () => {
    const fake = fakeStore({ triggers: { ...DEFAULT_TRIGGER_CONFIG, regular: 100 } });
    const { config, migrated } = createAppStore(fake).loadTriggerConfig();
    expect(config.regular).toBe(50);
    expect(migrated).toBe(true);
  });

  it("以降ユーザーが明示変更した値は尊重する: does not re-migrate a user-set 100 on the next launch", () => {
    const fake = fakeStore({ triggers: { ...DEFAULT_TRIGGER_CONFIG, regular: 100 } });

    // 1 回目の起動: 旧既定 100 → 50 に移行し、移行済みであることを永続化する
    const first = createAppStore(fake).loadTriggerConfig();
    expect(first.migrated).toBe(true);

    // ユーザーが設定 UI から意図的に 100 を選び直す
    createAppStore(fake).saveTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, regular: 100 });

    // 2 回目の起動: 100 は尊重され、再度 50 に上書きされない
    const second = createAppStore(fake).loadTriggerConfig();
    expect(second.config.regular).toBe(100);
    expect(second.migrated).toBe(false);
  });
});

describe("store / 統計の追記", () => {
  it("recordKeyCount accumulates total and per-day counts", () => {
    const fake = fakeStore({ stats: EMPTY_STATS });
    const store = createAppStore(fake);
    store.recordKeyCount("2026-07-25", 12);
    store.recordKeyCount("2026-07-25", 3);
    store.recordKeyCount("2026-07-26", 5);
    const stats = store.loadStats();
    expect(stats.totalKeyCount).toBe(20);
    expect(stats.dailyCounts).toEqual({ "2026-07-25": 15, "2026-07-26": 5 });
  });

  it("アクティブ秒数の累積: addActiveSeconds accumulates total and per-day seconds", () => {
    const fake = fakeStore({ stats: EMPTY_STATS });
    const store = createAppStore(fake);
    store.addActiveSeconds("2026-07-25", 30);
    store.addActiveSeconds("2026-07-25", 12);
    const stats = store.loadStats();
    expect(stats.totalActiveSeconds).toBe(42);
    expect(stats.dailyActiveSeconds).toEqual({ "2026-07-25": 42 });
  });

  it("履歴の記録: appendCheerHistory appends without dropping earlier entries", () => {
    const fake = fakeStore({ stats: EMPTY_STATS });
    const store = createAppStore(fake);
    const entry = {
      timestamp: "2026-07-25T10:00:00.000Z",
      count: 50,
      kpm: 120,
      speedZone: "normal" as const,
      type: "regular" as const,
      timeOfDay: "morning" as const,
      messageId: "normal_regular_morning-000",
      message: "いいペースだね!",
    };
    store.appendCheerHistory(entry);
    store.appendCheerHistory({ ...entry, count: 100 });
    const stats = store.loadStats();
    expect(stats.cheerHistory).toHaveLength(2);
    expect(stats.cheerHistory[1]?.count).toBe(100);
    // 入力内容は履歴に含めない(プライバシー方針)
    expect(Object.keys(stats.cheerHistory[0]!)).not.toContain("keys");
  });
});

describe("store / onboarding の読み書き(論点 0018)", () => {
  it("defaults skipMainWindowAutoShow to false when unset", () => {
    const store = createAppStore(fakeStore());
    expect(store.loadOnboarding()).toEqual(DEFAULT_ONBOARDING);
  });

  it("persists an updated onboarding value", () => {
    const fake = fakeStore();
    const store = createAppStore(fake);
    store.saveOnboarding({ skipMainWindowAutoShow: true });
    expect(createAppStore(fake).loadOnboarding()).toEqual({ skipMainWindowAutoShow: true });
  });
});

// 複数のキャラクターの保存・編集(論点 0032)。docs/character-creation.md「複数のキャラクターの保存・編集・削除」、
// docs/data-model.md の移行と既定値。1 キャラのみ・上書きの旧シナリオは論点 0032 で欠番。
const PROFILE_A = { name: "チア", personality: "元気いっぱい", voicevoxSpeakerId: 3 };
const PROFILE_B = { name: "ミズ", personality: "落ち着いている", voicevoxSpeakerId: 8 };

function savedCharacter(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `名前-${id}`,
    personality: "元気",
    imagePaths: {},
    voicevoxSpeakerId: 3,
    ...over,
  };
}

// 「保存し直さない」は set の呼び出しで見る(値が同じでも書き戻していれば判定が誤っている)
function countWrites(fake: ReturnType<typeof fakeStore>, keys: string[]): { count: () => number } {
  let writes = 0;
  const originalSet = fake.set;
  fake.set = ((key: string, value: unknown) => {
    if (keys.includes(key)) writes += 1;
    (originalSet as (k: string, v: unknown) => void)(key, value);
  }) as StoreLike["set"];
  return { count: () => writes };
}

describe("store / 新規保存でキャラクターが追加される", () => {
  it("S0032_01 appends a character with a new id and the profile only", () => {
    const fake = fakeStore({ characters: [savedCharacter("char-old")] });
    const store = createAppStore(fake, { newId: () => "char-new" });

    const saved = store.addCharacter(PROFILE_A);

    expect(saved).toEqual({ ok: true, id: "char-new" });
    // 次回起動時も読み出せる(同じ backing から別インスタンスで読む)
    const characters = createAppStore(fake).loadCharacters();
    expect(characters.map((c) => c.id)).toEqual(["char-old", "char-new"]);
    expect(characters[1]).toEqual({ id: "char-new", ...PROFILE_A, imagePaths: {} });
    expect(characters[1]).not.toHaveProperty("generatedBy");
  });

  it("uses an id that is safe as a directory name", () => {
    const store = createAppStore(fakeStore());

    const saved = store.addCharacter({ ...PROFILE_A, name: "チア / 危険\\名前" });

    // パス区切り・Windows で使えない文字を含まない(pool.json / voices/ のディレクトリ名になる)
    expect(saved.ok && saved.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("S0019_09 propagates the write failure instead of reporting success", () => {
    const backing = fakeStore();
    backing.set = (() => {
      throw new Error("EACCES");
    }) as StoreLike["set"];
    const store = createAppStore(backing);

    expect(() => store.addCharacter(PROFILE_A)).toThrow("EACCES");
  });
});

describe("store / 新規保存しても既存のキャラクターは変わらない [否定]", () => {
  it("S0032_02 leaves existing characters and activeCharacterId unchanged", () => {
    const existing = savedCharacter("char-1", { generatedBy: { text: "local-ollama" } });
    const fake = fakeStore({ characters: [existing], activeCharacterId: "char-1" });
    const store = createAppStore(fake, { newId: () => "char-2" });

    store.addCharacter(PROFILE_B);

    expect(store.loadCharacters()[0]).toEqual(existing);
    expect(store.loadActiveCharacterId()).toBe("char-1");
  });
});

describe("store / 上限の 10 件に達していたら新規保存しない [境界]", () => {
  it("S0032_03 refuses the 11th character and keeps characters unchanged", () => {
    const ten = Array.from({ length: 10 }, (_, i) => savedCharacter(`char-${i}`));
    const fake = fakeStore({ characters: ten });
    const store = createAppStore(fake);

    const saved = store.addCharacter(PROFILE_A);

    expect(saved).toEqual({ ok: false, reason: "limit-reached" });
    expect(store.loadCharacters()).toEqual(ten);
  });
});

describe("store / 既存のキャラクターを編集して保存する", () => {
  it("S0032_04 updates the profile and keeps the id and generatedBy", () => {
    const existing = savedCharacter("char-1", {
      generatedBy: { text: "local-ollama", voice: "local-voicevox" },
    });
    const store = createAppStore(fakeStore({ characters: [existing] }));

    const updated = store.updateCharacter("char-1", PROFILE_B);

    expect(updated).toEqual({ ok: true });
    expect(store.loadCharacters()).toEqual([
      {
        ...existing,
        ...PROFILE_B,
        id: "char-1",
        generatedBy: { text: "local-ollama", voice: "local-voicevox" },
      },
    ]);
  });
});

describe("store / 存在しないキャラクターの編集は拒否する [異常系]", () => {
  it("S0032_05 returns not-found and neither updates nor adds", () => {
    const existing = savedCharacter("char-1");
    const store = createAppStore(fakeStore({ characters: [existing] }));

    const updated = store.updateCharacter("char-missing", PROFILE_B);

    expect(updated).toEqual({ ok: false, reason: "not-found" });
    expect(store.loadCharacters()).toEqual([existing]);
  });
});

describe("store / 旧形式の `character` を読み込み時に移行する", () => {
  it("S0032_24 moves the legacy character into characters and makes it active when it has a pool", () => {
    const legacy = savedCharacter("char-legacy");
    const fake = fakeStore({ character: legacy });
    const store = createAppStore(fake, { hasPool: (id) => id === "char-legacy" });

    const characters = store.loadCharacters();

    expect(characters).toEqual([legacy]);
    expect(store.loadActiveCharacterId()).toBe("char-legacy");
    expect(fake.raw.characters).toEqual([legacy]);
    expect(fake.raw.activeCharacterId).toBe("char-legacy");
    expect(fake.raw.character).toBeUndefined();
  });
});

describe("store / プールが無い旧形式のキャラクターは使用中にしない [境界]", () => {
  it("S0032_25 migrates the legacy character without setting activeCharacterId", () => {
    const legacy = savedCharacter("char-legacy");
    const fake = fakeStore({ character: legacy });
    const store = createAppStore(fake, { hasPool: () => false });

    expect(store.loadCharacters()).toEqual([legacy]);
    expect(store.loadActiveCharacterId()).toBeUndefined();
    expect(fake.raw.activeCharacterId).toBeUndefined();
  });
});

describe("store / id を持たない旧形式のキャラクターには採番する [境界]", () => {
  it("S0032_26 assigns a new id to a legacy character without one", () => {
    const { id: _omitted, ...withoutId } = savedCharacter("unused");
    const fake = fakeStore({ character: withoutId });
    const store = createAppStore(fake, { hasPool: () => false, newId: () => "char-assigned" });

    expect(store.loadCharacters()).toEqual([{ ...withoutId, id: "char-assigned" }]);
  });
});

describe("store / 移行済みのデータは書き換えない [否定]", () => {
  it("S0032_27 keeps characters as the source of truth even when a legacy character remains", () => {
    const characters = [savedCharacter("char-1"), savedCharacter("char-2")];
    const fake = fakeStore({
      characters,
      activeCharacterId: "char-2",
      character: savedCharacter("char-legacy"),
    });
    const writes = countWrites(fake, ["characters", "activeCharacterId"]);
    const store = createAppStore(fake, { hasPool: () => true });

    expect(store.loadCharacters()).toEqual(characters);
    expect(store.loadActiveCharacterId()).toBe("char-2");
    expect(writes.count()).toBe(0);
  });
});

describe("store / 上限を超える件数を読み込んでも切り詰めない [境界]", () => {
  it("S0032_28 logs an error and loads every character without saving", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => savedCharacter(`char-${i}`));
    const fake = fakeStore({ characters: eleven });
    const writes = countWrites(fake, ["characters"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const characters = createAppStore(fake).loadCharacters();

    expect(characters).toEqual(eleven);
    expect(error).toHaveBeenCalled();
    expect(writes.count()).toBe(0);
    error.mockRestore();
  });
});

describe("store / `generation.shouldActivateOnComplete` の既定値 [境界]", () => {
  it("S0032_31 treats a missing or non-boolean value as true without rewriting it", () => {
    expect(createAppStore(fakeStore()).loadGeneration()).toEqual({
      shouldActivateOnComplete: true,
    });

    const fake = fakeStore({ generation: { shouldActivateOnComplete: "no" } });
    const writes = countWrites(fake, ["generation"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(createAppStore(fake).loadGeneration()).toEqual({ shouldActivateOnComplete: true });
    expect(fake.raw.generation).toEqual({ shouldActivateOnComplete: "no" });
    expect(writes.count()).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("store / system 設定の読み込みと既定値補完", () => {
  it("fills defaults when system is absent", () => {
    const store = createAppStore(fakeStore());
    const system = store.loadSystem();
    expect(system.ollamaEndpoint).toBe("http://localhost:11434");
    expect(system.voicevoxEndpoint).toBe("http://localhost:50021");
  });

  it("keeps values already present and fills only the missing ones", () => {
    const store = createAppStore(fakeStore({ system: { ollamaModel: "llama3" } }));
    const system = store.loadSystem();
    expect(system.ollamaModel).toBe("llama3");
    expect(system.voicevoxEndpoint).toBe("http://localhost:50021");
  });

  it("only ever points at localhost by default [不変条件]", () => {
    const system = createAppStore(fakeStore()).loadSystem();
    for (const url of [system.ollamaEndpoint, system.voicevoxEndpoint]) {
      expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(url).hostname);
    }
  });

  it("replaces a non-array excludedApps with the default (JSON 直接編集への防御)", () => {
    // 要件: docs/data-model.md「既存設定の読み込みと既定値補完」(型に適合した設定オブジェクトになる)
    const store = createAppStore(fakeStore({ system: { excludedApps: "code.exe" } }));

    expect(store.loadSystem().excludedApps).toEqual([]);
  });
});

describe("store / 除外設定はスキーマだけ用意しカウントには効かない", () => {
  it("S0011_09 除外設定: 既定は空配列で、カウント経路のどこからも参照されない", () => {
    // GIVEN 除外リストに値が入った設定(将来の実装を先取りして書かれた JSON)
    const store = createAppStore(fakeStore({ system: { excludedApps: ["code.exe"] } }));

    // WHEN 設定を読み込む
    const system = store.loadSystem();

    // THEN スキーマとしては存在し、値も保持される
    expect(system.excludedApps).toEqual(["code.exe"]);
    expect(system.excludedKeys).toEqual([]);
    expect(DEFAULT_SYSTEM_CONFIG.excludedApps).toEqual([]);
    expect(DEFAULT_SYSTEM_CONFIG.excludedKeys).toEqual([]);

    // THEN しかしカウント経路は誰もこの値を読まない(常に全アプリ・全キーが対象)
    const countingPath = [
      "src/core/keyCounter.ts",
      "src/core/runtime.ts",
      "src/main/keyHook.ts",
      "src/main/cheerRuntime.ts",
    ];
    const readers = countingPath.filter((file) =>
      /excluded/i.test(readFileSync(join(import.meta.dirname, "..", "..", file), "utf8")),
    );
    expect(readers).toEqual([]);
  });
});

// 生成元の記録(論点 0022)。`generatedBy` は「実際に作った」プロバイダーで、
// `providers` の選択値とは別物。選択値をここへ流し込まない。
const SAVED_CHARACTER = {
  id: "char-1",
  name: "チア",
  personality: "元気いっぱい",
  imagePaths: {},
  voicevoxSpeakerId: 3,
};
const SELECTED_PROVIDERS = { text: "openai", voice: "openai-tts", image: "stability-ai" };

describe("store / 生成していない種別は未設定のまま [否定]", () => {
  it("S0022_04 does not write the selected image provider into generatedBy", () => {
    const backing = fakeStore({ characters: [SAVED_CHARACTER], providers: SELECTED_PROVIDERS });
    const store = createAppStore(backing);

    store.recordGeneratedBy("char-1", { text: "local-ollama", voice: "local-voicevox" });

    const generatedBy = store.loadCharacters()[0]?.generatedBy;
    expect(generatedBy).toEqual({ text: "local-ollama", voice: "local-voicevox" });
    expect(generatedBy).not.toHaveProperty("image");
  });
});

describe("store / generatedBy は既定値で補完しない [境界]", () => {
  it("S0022_09 leaves missing kinds unset instead of filling them from providers", () => {
    const partial = createAppStore(
      fakeStore({
        characters: [{ ...SAVED_CHARACTER, generatedBy: { text: "anthropic" } }],
        providers: SELECTED_PROVIDERS,
      }),
    );
    expect(partial.loadCharacters()[0]?.generatedBy).toEqual({ text: "anthropic" });

    // 旧バージョン JSON(generatedBy そのものが無い)でも選択値で埋めない
    const legacy = createAppStore(
      fakeStore({ characters: [SAVED_CHARACTER], providers: SELECTED_PROVIDERS }),
    );
    expect(legacy.loadCharacters()[0]?.generatedBy ?? {}).toEqual({});
  });
});

// 既定モデルの変更と旧既定値の移行(論点 0028)。
// 「保存し直さない」は set の呼び出しで見る — 値が同じでも書き戻していれば移行の判定が誤っている。
function countSystemWrites(fake: ReturnType<typeof fakeStore>): { count: () => number } {
  let writes = 0;
  const originalSet = fake.set;
  fake.set = ((key: string, value: unknown) => {
    if (key === "system") writes += 1;
    (originalSet as (k: string, v: unknown) => void)(key, value);
  }) as StoreLike["set"];
  return { count: () => writes };
}

describe("store / system.ollamaModel の既定値と移行", () => {
  it("S0028_01 defaults ollamaModel to sarashina2.2-3b-instruct", () => {
    const system = createAppStore(fakeStore()).loadSystem();

    expect(system.ollamaModel).toBe("sarashina2.2-3b-instruct");
  });

  it("S0028_02 migrates the legacy default gemma2:2b and saves it back", () => {
    const fake = fakeStore({ system: { ollamaModel: "gemma2:2b" } });

    const system = createAppStore(fake).loadSystem();

    expect(system.ollamaModel).toBe("sarashina2.2-3b-instruct");
    expect((fake.raw.system as { ollamaModel?: string }).ollamaModel).toBe(
      "sarashina2.2-3b-instruct",
    );
  });

  it("S0028_03 keeps a model the user set themselves and does not save", () => {
    const fake = fakeStore({ system: { ollamaModel: "llama3.2:3b" } });
    const writes = countSystemWrites(fake);

    const system = createAppStore(fake).loadSystem();

    expect(system.ollamaModel).toBe("llama3.2:3b");
    expect(writes.count()).toBe(0);
  });

  it("S0028_04 does not rewrite an already migrated value", () => {
    const fake = fakeStore({ system: { ollamaModel: "sarashina2.2-3b-instruct" } });
    const writes = countSystemWrites(fake);

    const system = createAppStore(fake).loadSystem();

    expect(system.ollamaModel).toBe("sarashina2.2-3b-instruct");
    expect(writes.count()).toBe(0);
  });

  it("S0028_05 leaves the other system settings unchanged when migrating", () => {
    const stored = {
      ollamaModel: "gemma2:2b",
      ollamaEndpoint: "http://127.0.0.1:12345",
      voicevoxEndpoint: "http://127.0.0.1:23456",
      excludedApps: ["code.exe"],
      excludedKeys: ["F13"],
    };
    const fake = fakeStore({ system: { ...stored } });

    const system = createAppStore(fake).loadSystem();

    expect(system).toEqual({ ...stored, ollamaModel: "sarashina2.2-3b-instruct" });
    expect(fake.raw.system).toEqual({ ...stored, ollamaModel: "sarashina2.2-3b-instruct" });
  });
});

// 設定画面での変更(論点 0033)。docs/main-window.md「メインウィンドウの画面」
describe("store / 設定画面で生成後に自動で使用中にするかを変える", () => {
  it("S0033_13 persists shouldActivateOnComplete = false so the next load reads it back", () => {
    const fake = fakeStore({ generation: { shouldActivateOnComplete: true } });

    createAppStore(fake).saveGeneration({ shouldActivateOnComplete: false });

    expect(createAppStore(fake).loadGeneration()).toEqual({ shouldActivateOnComplete: false });
  });
});

describe("store / 設定の変更は他の保存データを変えない [否定]", () => {
  it("S0033_14 leaves characters, activeCharacterId, triggers and stats unchanged", () => {
    const initial = {
      characters: [savedCharacter("char-1")],
      activeCharacterId: "char-1",
      triggers: { ...DEFAULT_TRIGGER_CONFIG, regular: 70 },
      stats: { ...EMPTY_STATS, totalKeyCount: 1234 },
    };
    const fake = fakeStore(structuredClone(initial));

    createAppStore(fake).saveGeneration({ shouldActivateOnComplete: false });

    expect(fake.raw.characters).toEqual(initial.characters);
    expect(fake.raw.activeCharacterId).toBe("char-1");
    expect(fake.raw.triggers).toEqual(initial.triggers);
    expect(fake.raw.stats).toEqual(initial.stats);
  });
});
