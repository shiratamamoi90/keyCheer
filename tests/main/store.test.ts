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
    expect(config.milestoneInterval).toBe(250);
    expect(migrated).toBe(false);
  });

  it("replaces invalid values with defaults (JSON 直接編集への防御)", () => {
    const store = createAppStore(fakeStore({ triggers: { regular: -1, milestoneInterval: "x" } }));
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

// --- 節目を 1 つの回数にする(論点 0071)---

// set の呼び出しを数える(保存し直したかを見る)
function countingStore(initial: Record<string, unknown>) {
  const fake = fakeStore(initial);
  const setKeys: string[] = [];
  const set = fake.set;
  fake.set = ((key: string, value: unknown) => {
    setKeys.push(key);
    (set as (k: string, v: unknown) => void)(key, value);
  }) as StoreLike["set"];
  return { fake, setKeys };
}

describe("store / 節目の既定値 [境界]", () => {
  it("S0071_06 fills milestoneInterval = 250 and isMilestoneEnabled = true when neither is saved", () => {
    const fake = fakeStore({ triggers: { regular: 50 } });
    const { config } = createAppStore(fake).loadTriggerConfig();
    expect(config.milestoneInterval).toBe(250);
    expect(config.isMilestoneEnabled).toBe(true);
  });
});

describe("store / 読み込んだ値が値域の外なら直す [異常系]", () => {
  it("S0071_09 fixes only the out-of-range values, saves them and logs an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeStore({
      triggers: {
        regular: 0,
        milestoneInterval: 250,
        isMilestoneEnabled: true,
      },
    });
    expect(createAppStore(fake).loadTriggerConfig().config).toEqual({
      regular: 50,
      milestoneInterval: 250,
      isMilestoneEnabled: true,
    });

    const fake2 = fakeStore({
      triggers: {
        regular: 300,
        milestoneInterval: 200,
        isMilestoneEnabled: true,
      },
    });
    createAppStore(fake2).loadTriggerConfig();
    expect(fake2.raw.triggers).toEqual({
      regular: 300,
      milestoneInterval: 1500,
      isMilestoneEnabled: true,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("store / 前の版の節目の一覧を移す", () => {
  it("S0071_10 moves a non-empty list to interval 250 enabled, removes the list and does not notify", () => {
    const fake = fakeStore({
      triggers: {
        regular: 50,
        milestones: [1000, 5000, 10000, 50000, 100000],
      },
    });
    const { config, migrated } = createAppStore(fake).loadTriggerConfig();
    expect(config).toEqual({
      regular: 50,
      milestoneInterval: 250,
      isMilestoneEnabled: true,
    });
    expect(fake.raw.triggers).toEqual(config);
    expect(migrated).toBe(false);
  });
});

describe("store / 前の版の空の一覧は節目を出さない設定に移す [境界]", () => {
  it("S0071_11 moves an empty list to disabled with interval 250", () => {
    const fake = fakeStore({ triggers: { regular: 50, milestones: [] } });
    createAppStore(fake).loadTriggerConfig();
    expect(fake.raw.triggers).toEqual({
      regular: 50,
      milestoneInterval: 250,
      isMilestoneEnabled: false,
    });
  });
});

describe("store / 前の版で回数が 250 以上なら節目を回数の 5 倍にする [境界]", () => {
  it("S0071_12 sets milestoneInterval to 1500 for regular = 300", () => {
    const fake = fakeStore({
      triggers: { regular: 300, milestones: [1000] },
    });
    const { config } = createAppStore(fake).loadTriggerConfig();
    expect(config.milestoneInterval).toBe(1500);
    expect(config.isMilestoneEnabled).toBe(true);
  });
});

describe("store / 節目の移行は他の設定項目に波及しない [否定]", () => {
  it("S0071_13 keeps regular while moving the list", () => {
    const fake = fakeStore({
      triggers: { regular: 30, milestones: [1000, 5000] },
    });
    const { config } = createAppStore(fake).loadTriggerConfig();
    expect(config.regular).toBe(30);
  });
});

describe("store / 移行済みの値は保存し直さない [境界]", () => {
  it("S0071_14 leaves a valid new-format value as it is without saving it again", () => {
    const triggers = {
      regular: 50,
      milestoneInterval: 500,
      isMilestoneEnabled: false,
    };
    const { fake, setKeys } = countingStore({ triggers: { ...triggers } });
    const { config } = createAppStore(fake).loadTriggerConfig();
    expect(config).toEqual(triggers);
    expect(setKeys).not.toContain("triggers");
  });
});

describe("store / 応援の欄の変更は他の設定と保存データを変えない [否定]", () => {
  it("S0070_09 saving triggers leaves characters, popup, theme, generation and stats unchanged", () => {
    const initial = {
      characters: [savedCharacter("char-1")],
      activeCharacterId: "char-1",
      popup: { shouldAlwaysShow: false, shouldShowMessage: false },
      ui: { theme: "dark" },
      generation: { shouldActivateOnComplete: false },
      triggers: { ...DEFAULT_TRIGGER_CONFIG },
      stats: { ...EMPTY_STATS, totalKeyCount: 1234 },
    };
    const fake = fakeStore(structuredClone(initial));

    createAppStore(fake).saveTriggerConfig({ ...DEFAULT_TRIGGER_CONFIG, regular: 80 });

    const { triggers: _saved, ...rest } = fake.raw;
    const { triggers: _initial, ...initialRest } = initial;
    expect(rest).toMatchObject(initialRest);
    expect(fake.raw.triggers).toEqual({ ...DEFAULT_TRIGGER_CONFIG, regular: 80 });
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
    expect(system.ollamaEndpoint).toBe("http://127.0.0.1:11434");
    expect(system.voicevoxEndpoint).toBe("http://127.0.0.1:50021");
  });

  it("keeps values already present and fills only the missing ones", () => {
    const store = createAppStore(fakeStore({ system: { ollamaModel: "llama3" } }));
    const system = store.loadSystem();
    expect(system.ollamaModel).toBe("llama3");
    expect(system.voicevoxEndpoint).toBe("http://127.0.0.1:50021");
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

// 生成元の記録(論点 0022)。`generatedBy` は「実際に作った」プロバイダーだけを持つ。
const SAVED_CHARACTER = {
  id: "char-1",
  name: "チア",
  personality: "元気いっぱい",
  imagePaths: {},
  voicevoxSpeakerId: 3,
};

describe("store / 生成していない種別は未設定のまま [否定]", () => {
  it("S0022_04 does not write the image provider id into generatedBy when no image was made", () => {
    const backing = fakeStore({ characters: [SAVED_CHARACTER] });
    const store = createAppStore(backing);

    store.recordGeneratedBy("char-1", { text: "local-ollama", voice: "local-voicevox" });

    const generatedBy = store.loadCharacters()[0]?.generatedBy;
    expect(generatedBy).toEqual({ text: "local-ollama", voice: "local-voicevox" });
    expect(generatedBy).not.toHaveProperty("image");
  });
});

describe("store / generatedBy は既定値で補完しない [境界]", () => {
  it("S0022_09 leaves missing kinds unset instead of filling them with provider ids", () => {
    const partial = createAppStore(
      fakeStore({ characters: [{ ...SAVED_CHARACTER, generatedBy: { text: "local-ollama" } }] }),
    );
    expect(partial.loadCharacters()[0]?.generatedBy).toEqual({ text: "local-ollama" });

    // 旧バージョン JSON(generatedBy そのものが無い)でもプロバイダーの識別子で埋めない
    const legacy = createAppStore(fakeStore({ characters: [SAVED_CHARACTER] }));
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

// キャラ画像の常時表示(論点 0036)。docs/data-model.md / docs/main-window.md
describe("store / `popup.shouldAlwaysShow` の既定値 [境界]", () => {
  it("S0036_27 treats a missing or non-boolean value as true without rewriting it", () => {
    expect(createAppStore(fakeStore()).loadPopupDisplay()).toMatchObject({
      shouldAlwaysShow: true,
    });

    const fake = fakeStore({ popup: { position: "bottom-right", shouldAlwaysShow: "yes" } });
    const writes = countWrites(fake, ["popup"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(createAppStore(fake).loadPopupDisplay()).toMatchObject({ shouldAlwaysShow: true });
    expect(fake.raw.popup).toEqual({ position: "bottom-right", shouldAlwaysShow: "yes" });
    expect(writes.count()).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("store / 旧形式の `imagePaths` は読まず、書き換えもしない [否定]", () => {
  it("S0036_28 keeps the legacy imagePaths as they are and does not save", () => {
    const legacy = { normal: "C:/old/normal.png", happy: "C:/old/happy.png", excited: "x" };
    const characters = [savedCharacter("char-1", { imagePaths: legacy })];
    const fake = fakeStore({ characters: structuredClone(characters) });
    const writes = countWrites(fake, ["characters"]);

    const loaded = createAppStore(fake).loadCharacters();

    expect(loaded).toEqual(characters);
    expect(writes.count()).toBe(0);
  });
});

describe("store / 設定画面で常時表示を切り替える", () => {
  it("S0036_29 persists shouldAlwaysShow and keeps the other popup settings", () => {
    const fake = fakeStore({ popup: { position: "bottom-right", duration: 5000, opacity: 0.95 } });
    const store = createAppStore(fake);

    store.savePopupDisplay({ shouldAlwaysShow: false, shouldShowMessage: true });
    expect(createAppStore(fake).loadPopupDisplay()).toMatchObject({ shouldAlwaysShow: false });

    store.savePopupDisplay({ shouldAlwaysShow: true, shouldShowMessage: true });
    expect(createAppStore(fake).loadPopupDisplay()).toMatchObject({ shouldAlwaysShow: true });
    expect(fake.raw.popup).toMatchObject({
      position: "bottom-right",
      duration: 5000,
      opacity: 0.95,
      shouldAlwaysShow: true,
    });
  });
});

// セリフを出すかの設定(論点 0053)。docs/data-model.md / docs/main-window.md
describe("store / `popup.shouldShowMessage` の既定値 [境界]", () => {
  it("S0053_07 treats a missing or non-boolean value as true without rewriting it", () => {
    // GIVEN popup.shouldShowMessage が無い設定 JSON / WHEN 読み込む / THEN true
    expect(createAppStore(fakeStore()).loadPopupDisplay().shouldShowMessage).toBe(true);
    expect(
      createAppStore(fakeStore({ popup: { shouldAlwaysShow: false } })).loadPopupDisplay(),
    ).toEqual({ shouldAlwaysShow: false, shouldShowMessage: true });

    // GIVEN 真偽値でない値 / THEN true として扱い、保存値は書き換えずエラーを記録する
    const fake = fakeStore({ popup: { shouldAlwaysShow: true, shouldShowMessage: "no" } });
    const writes = countWrites(fake, ["popup"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(createAppStore(fake).loadPopupDisplay().shouldShowMessage).toBe(true);
    expect(fake.raw.popup).toEqual({ shouldAlwaysShow: true, shouldShowMessage: "no" });
    expect(writes.count()).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("store / 設定画面でセリフを出すかを切り替える", () => {
  it("S0053_08 persists shouldShowMessage and keeps the other popup settings", () => {
    // GIVEN popup.shouldShowMessage = true、動かした位置を覚えている
    const fake = fakeStore({
      popup: {
        shouldAlwaysShow: true,
        shouldShowMessage: true,
        customPosition: { x: 830, y: 380 },
      },
    });
    const store = createAppStore(fake);

    // WHEN 設定画面で「セリフを表示する」を外して保存する
    store.savePopupDisplay({ shouldAlwaysShow: true, shouldShowMessage: false });

    // THEN false として永続化し、popup のほかの設定は変化しない
    expect(createAppStore(fake).loadPopupDisplay()).toEqual({
      shouldAlwaysShow: true,
      shouldShowMessage: false,
    });
    expect(fake.raw.popup).toEqual({
      shouldAlwaysShow: true,
      shouldShowMessage: false,
      customPosition: { x: 830, y: 380 },
    });

    // 付け直したら出す
    store.savePopupDisplay({ shouldAlwaysShow: true, shouldShowMessage: true });
    expect(createAppStore(fake).loadPopupDisplay().shouldShowMessage).toBe(true);
  });
});

describe("store / 保存済みのキャラクターが選べる話者以外を指していても値を変えない [否定]", () => {
  it("S0044_05 keeps a saved speaker id outside the selectable speakers as it is", () => {
    // GIVEN 保存済みのキャラクターの voicevoxSpeakerId が、選べる話者以外の ID(3)
    const saved = [
      { id: "char-a", name: "A", personality: "p", voicevoxSpeakerId: 3 },
      { id: "char-b", name: "B", personality: "p", voicevoxSpeakerId: 8 },
    ];
    const fake = fakeStore({ characters: saved });
    const before = JSON.stringify(fake.get("characters"));

    // WHEN 設定を読み込む
    const characters = createAppStore(fake).loadCharacters();

    // THEN voicevoxSpeakerId は変化しない。ほかのキャラクターの値も、保存データも変化しない
    expect(characters.map((c) => c.voicevoxSpeakerId)).toEqual([3, 8]);
    expect(JSON.stringify(fake.get("characters"))).toBe(before);
  });
});

describe("store / 動かした位置を覚え、次の起動でその位置に出す", () => {
  it("S0052_06 saves the moved position without touching the other popup settings", () => {
    // GIVEN 窓をドラッグして (830, 380) で離した
    const fake = fakeStore({ popup: { shouldAlwaysShow: false, duration: 5000 } });
    createAppStore(fake).savePopupPosition({ x: 830, y: 380 });

    // WHEN アプリを起動し直す(保存データを読み直す)
    const store = createAppStore(fake);

    // THEN その位置が読める。popup のほかの設定は変化しない
    expect(store.loadPopupPosition()).toEqual({ x: 830, y: 380 });
    expect(store.loadPopupDisplay()).toMatchObject({ shouldAlwaysShow: false });
    expect(fake.get("popup")).toEqual({
      shouldAlwaysShow: false,
      duration: 5000,
      customPosition: { x: 830, y: 380 },
    });
  });

  it("returns null when no position was saved", () => {
    expect(createAppStore(fakeStore()).loadPopupPosition()).toBeNull();
  });
});

// テーマ(論点 0057)。docs/data-model.md / docs/main-window.md
describe("store / `ui.theme` の既定値 [境界]", () => {
  it("S0057_08 treats a missing or out-of-domain theme as system without rewriting it", () => {
    expect(createAppStore(fakeStore()).loadUiConfig()).toEqual({ theme: "system" });
    expect(createAppStore(fakeStore({ ui: { theme: "dark" } })).loadUiConfig()).toEqual({
      theme: "dark",
    });

    const fake = fakeStore({ ui: { theme: "sepia" } });
    const writes = countWrites(fake, ["ui"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(createAppStore(fake).loadUiConfig()).toEqual({ theme: "system" });
    expect(fake.raw.ui).toEqual({ theme: "sepia" });
    expect(writes.count()).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("store / テーマの変更は他の設定と保存データを変えない [否定]", () => {
  it("S0057_07 saves only ui.theme", () => {
    const initial = {
      characters: [
        { id: "c1", name: "チア", personality: "元気", imagePaths: {}, voicevoxSpeakerId: 3 },
      ],
      triggers: { regular: 70, milestones: [1000] },
      popup: { shouldAlwaysShow: false, shouldShowMessage: true, customPosition: { x: 1, y: 2 } },
      stats: { totalKeyCount: 12 },
    };
    const fake = fakeStore(structuredClone(initial));
    createAppStore(fake).saveUiConfig({ theme: "dark" });

    expect(fake.raw.ui).toEqual({ theme: "dark" });
    expect(fake.raw.characters).toEqual(initial.characters);
    expect(fake.raw.triggers).toEqual(initial.triggers);
    expect(fake.raw.popup).toEqual(initial.popup);
    expect(fake.raw.stats).toEqual(initial.stats);
  });
});

// 接続先を 127.0.0.1 にそろえる(論点 0078)。docs/data-model.md
describe("store / 接続先の既定値は 127.0.0.1 [境界]", () => {
  it("S0078_01 fills the endpoints with 127.0.0.1 when they are not saved", () => {
    const system = createAppStore(fakeStore({ system: {} })).loadSystem();
    expect(system.ollamaEndpoint).toBe("http://127.0.0.1:11434");
    expect(system.voicevoxEndpoint).toBe("http://127.0.0.1:50021");
  });
});

describe("store / 旧既定値の接続先を移す", () => {
  it("S0078_02 moves the former localhost defaults and saves them again", () => {
    const fake = fakeStore({
      system: {
        ollamaEndpoint: "http://localhost:11434",
        voicevoxEndpoint: "http://localhost:50021",
      },
    });
    const system = createAppStore(fake).loadSystem();
    expect(system.ollamaEndpoint).toBe("http://127.0.0.1:11434");
    expect(system.voicevoxEndpoint).toBe("http://127.0.0.1:50021");
    expect(fake.raw.system).toEqual({
      ollamaEndpoint: "http://127.0.0.1:11434",
      voicevoxEndpoint: "http://127.0.0.1:50021",
    });
  });
});

describe("store / 利用者が変えた接続先は移さない [否定]", () => {
  it("S0078_03 keeps a user-set endpoint and does not save again", () => {
    const { fake, setKeys } = countingStore({
      system: { ollamaEndpoint: "http://192.168.0.5:11434" },
    });
    expect(createAppStore(fake).loadSystem().ollamaEndpoint).toBe("http://192.168.0.5:11434");
    expect(setKeys).not.toContain("system");
  });
});

describe("store / 接続先の移行は他の設定項目に波及しない [否定]", () => {
  it("S0078_04 leaves the other system values unchanged", () => {
    const fake = fakeStore({
      system: {
        ollamaEndpoint: "http://localhost:11434",
        ollamaModel: "my-model",
        excludedKeys: ["F1"],
      },
    });
    const system = createAppStore(fake).loadSystem();
    expect(system.ollamaModel).toBe("my-model");
    expect(system.excludedKeys).toEqual(["F1"]);
  });
});

// 論点 0080 / 0081: 応援に要る累計カウントだけを記録し、前の版が残した記録は起動時に消す
const LEGACY_STATS = {
  totalKeyCount: 12345,
  totalActiveSeconds: 3600,
  dailyCounts: { "2026-11-26": 4000 },
  dailyActiveSeconds: { "2026-11-26": 1800 },
  cheerHistory: [
    {
      timestamp: "2026-11-26T10:00:00.000Z",
      count: 50,
      kpm: 120,
      speedZone: "normal",
      type: "regular",
      timeOfDay: "morning",
      messageId: "normal_regular_morning-000",
      message: "いいペースだね!",
    },
  ],
};

describe("store / 起動時に、保存済みの応援履歴を消す", () => {
  it("S0080_02 removes cheerHistory from the saved stats on launch", () => {
    const fake = fakeStore({
      stats: { totalKeyCount: 10, cheerHistory: LEGACY_STATS.cheerHistory },
    });
    createAppStore(fake).loadStats();
    expect(fake.raw.stats).not.toHaveProperty("cheerHistory");
  });
});

describe("store / 応援履歴が無くても起動は続く [境界]", () => {
  it("S0080_03 keeps stats without cheerHistory as they are and creates no empty cheerHistory", () => {
    const { fake, setKeys } = countingStore({ stats: { totalKeyCount: 10 } });
    const stats = createAppStore(fake).loadStats();
    expect(stats).toEqual({ totalKeyCount: 10 });
    expect(fake.raw.stats).toEqual({ totalKeyCount: 10 });
    expect(setKeys).not.toContain("stats");
  });
});

describe("store / 応援履歴のほかの統計と設定には触らない [否定]", () => {
  it("S0080_04 leaves totalKeyCount, settings and characters unchanged when removing cheerHistory", () => {
    const initial = {
      stats: { totalKeyCount: 10, cheerHistory: LEGACY_STATS.cheerHistory },
      triggers: { regular: 30, milestoneInterval: 500, isMilestoneEnabled: true },
      characters: [savedCharacter("char-1")],
      activeCharacterId: "char-1",
    };
    const fake = fakeStore(structuredClone(initial));
    createAppStore(fake).loadStats();
    const { stats, ...rest } = fake.raw;
    const { stats: _initialStats, ...initialRest } = initial;
    expect(stats).toEqual({ totalKeyCount: 10 });
    expect(rest).toMatchObject(initialRest);
  });
});

describe("store / キーを打っても累計カウントのほかは保存しない [否定]", () => {
  it("S0081_02 saves only totalKeyCount when recording key presses", () => {
    const fake = fakeStore({ stats: { totalKeyCount: 0 } });
    const store = createAppStore(fake);
    store.recordKeyCount(12);
    store.recordKeyCount(3);
    expect(fake.raw.stats).toEqual({ totalKeyCount: 15 });
  });
});

describe("store / 起動時に、保存済みの日ごとの押下数とアクティブ時間を消す", () => {
  it("S0081_03 removes dailyCounts, totalActiveSeconds and dailyActiveSeconds on launch", () => {
    const { cheerHistory: _history, ...legacy } = LEGACY_STATS;
    const fake = fakeStore({ stats: structuredClone(legacy) });
    createAppStore(fake).loadStats();
    expect(fake.raw.stats).toEqual({ totalKeyCount: 12345 });
  });
});

describe("store / 起動時に、止まったとみなす秒数の設定を消す", () => {
  it("S0081_04 removes triggers.activeThresholdSec on launch, even when it is out of range, without logging", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeStore({
      triggers: {
        regular: 30,
        milestoneInterval: 500,
        isMilestoneEnabled: true,
        activeThresholdSec: 9999,
      },
    });
    const { config } = createAppStore(fake).loadTriggerConfig();
    expect(config).toEqual({ regular: 30, milestoneInterval: 500, isMilestoneEnabled: true });
    expect(fake.raw.triggers).toEqual({
      regular: 30,
      milestoneInterval: 500,
      isMilestoneEnabled: true,
    });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("store / 消すものが無ければ保存し直さない [境界]", () => {
  it("S0081_05 saves neither stats nor triggers again when nothing is left to remove", () => {
    const { fake, setKeys } = countingStore({
      stats: { totalKeyCount: 7 },
      triggers: { regular: 50, milestoneInterval: 250, isMilestoneEnabled: true },
    });
    const store = createAppStore(fake);
    store.loadStats();
    store.loadTriggerConfig();
    expect(setKeys).toEqual([]);

    const { fake: empty, setKeys: emptySetKeys } = countingStore({});
    expect(createAppStore(empty).loadStats()).toEqual({ totalKeyCount: 0 });
    expect(emptySetKeys).not.toContain("stats");
  });
});

describe("store / 累計カウントとほかの設定には触らない [否定]", () => {
  it("S0081_06 keeps totalKeyCount = 12345 and everything but the four removed keys", () => {
    const initial = {
      stats: structuredClone(LEGACY_STATS),
      triggers: {
        regular: 30,
        milestoneInterval: 500,
        isMilestoneEnabled: false,
        activeThresholdSec: 90,
      },
      popup: { shouldAlwaysShow: false, shouldShowMessage: false },
      characters: [savedCharacter("char-1")],
      activeCharacterId: "char-1",
    };
    const fake = fakeStore(structuredClone(initial));
    const store = createAppStore(fake);
    store.loadStats();
    store.loadTriggerConfig();

    expect(fake.raw.stats).toEqual({ totalKeyCount: 12345 });
    expect(fake.raw.triggers).toEqual({
      regular: 30,
      milestoneInterval: 500,
      isMilestoneEnabled: false,
    });
    expect(fake.raw.popup).toEqual(initial.popup);
    expect(fake.raw.characters).toEqual(initial.characters);
    expect(fake.raw.activeCharacterId).toBe("char-1");
  });
});
