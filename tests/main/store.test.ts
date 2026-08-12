// main/store: 設定の読み込み・マイグレーション・統計追記の契約。
// 要件: docs/data-model.md「既存設定の読み込みと既定値補完」/「triggers.regular = 100 のマイグレーション [境界]」
// electron-store は StoreLike で注入できるため、main 層でもここは決定的にテストできる。

import { describe, it, expect } from "vitest";
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

describe("store / character の読み込み(論点 0018)", () => {
  it("returns undefined when no character has been saved yet", () => {
    const store = createAppStore(fakeStore());
    expect(store.loadCharacter()).toBeUndefined();
  });

  it("returns the saved character as-is", () => {
    const character = {
      name: "チア",
      personality: "元気いっぱい",
      imagePaths: { normal: "n.png" },
      voicevoxSpeakerId: 3,
      generatedBy: { text: "local-ollama", voice: "local-voicevox", image: "local-sdcpp" },
    };
    const store = createAppStore(fakeStore({ character }));
    expect(store.loadCharacter()).toEqual(character);
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

// spec: 論点 0019
//   「保存するとプロフィールが永続化される」「保存に失敗した場合 [異常系]」
describe("store / 保存するとプロフィールが永続化される", () => {
  it("S0019_08 persists the profile so the next load reads it back", () => {
    const backing = fakeStore();
    const store = createAppStore(backing);

    store.saveCharacter({ name: "チア", personality: "元気いっぱい", voicevoxSpeakerId: 3 });

    expect(store.loadCharacter()).toMatchObject({
      name: "チア",
      personality: "元気いっぱい",
      voicevoxSpeakerId: 3,
    });
  });

  it("overwrites the previous character (1 キャラのみ)", () => {
    const store = createAppStore(fakeStore());

    store.saveCharacter({ name: "A", personality: "p1", voicevoxSpeakerId: 1 });
    store.saveCharacter({ name: "B", personality: "p2", voicevoxSpeakerId: 2 });

    expect(store.loadCharacter()).toMatchObject({ name: "B", voicevoxSpeakerId: 2 });
  });

  it("does not invent image paths (画像は別の論点)", () => {
    const store = createAppStore(fakeStore());

    store.saveCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 });

    const saved = store.loadCharacter();
    expect(saved?.imagePaths ?? {}).toEqual({});
  });
});

describe("store / 保存に失敗した場合 [異常系]", () => {
  it("S0019_09 propagates the write failure instead of reporting success", () => {
    const backing = fakeStore();
    backing.set = (() => {
      throw new Error("EACCES");
    }) as StoreLike["set"];
    const store = createAppStore(backing);

    expect(() =>
      store.saveCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 }),
    ).toThrow();
  });
});

// spec: 論点 0020
//   「characterId はキャラ保存時に決まる」「characterId は名前を変えても変わらない [不変条件]」
describe("store / characterId はキャラ保存時に決まる", () => {
  it("assigns an id on the first save", () => {
    const store = createAppStore(fakeStore());
    store.saveCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 });
    const saved = store.loadCharacter();
    expect(typeof saved?.id).toBe("string");
    expect(saved?.id.length).toBeGreaterThan(0);
  });

  it("uses an id that is safe as a directory name", () => {
    const store = createAppStore(fakeStore());
    store.saveCharacter({ name: "チア / 危険\\名前", personality: "元気", voicevoxSpeakerId: 3 });
    // パス区切り・Windows で使えない文字を含まない(pool.json / voices/ のディレクトリ名になる)
    expect(store.loadCharacter()?.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("store / characterId は名前を変えても変わらない [不変条件]", () => {
  it("keeps the id across profile updates", () => {
    const store = createAppStore(fakeStore());
    store.saveCharacter({ name: "チア", personality: "元気", voicevoxSpeakerId: 3 });
    const first = store.loadCharacter()?.id;

    store.saveCharacter({ name: "別の名前", personality: "冷静", voicevoxSpeakerId: 8 });
    expect(store.loadCharacter()?.id).toBe(first);
    expect(store.loadCharacter()?.name).toBe("別の名前");
  });
});

describe("store / system 設定の読み込みと既定値補完", () => {
  it("fills defaults when system is absent", () => {
    const store = createAppStore(fakeStore());
    const system = store.loadSystem();
    expect(system.ollamaEndpoint).toBe("http://localhost:11434");
    expect(system.voicevoxEndpoint).toBe("http://localhost:50021");
    expect(system.ollamaModel).toBe("gemma2:2b");
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
