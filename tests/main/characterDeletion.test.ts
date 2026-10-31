// main/characterDeletion: キャラクターの削除(保存データ・生成物・使用中の解除)。
// 要件: docs/character-creation.md「複数のキャラクターの保存・編集・削除」(論点 0032)
// store は StoreLike の偽物で、fs はインメモリの偽物で注入する。実ファイルは消さない。

import { describe, it, expect, vi } from "vitest";
import { deleteCharacter } from "../../src/main/characterDeletion.js";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import type { CharacterFs } from "../../src/main/characterStore.js";

const USER_DATA = "/userdata";

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

function fakeFs(paths: string[]): CharacterFs & { files: Set<string> } {
  const files = new Set(paths);
  return {
    files,
    exists: (p) => files.has(p),
    readFile: () => undefined,
    writeFile: (p) => {
      files.add(p);
    },
    mkdirRecursive: () => {},
    removeDirRecursive: (p) => {
      for (const file of [...files]) if (file.startsWith(`${p}/`)) files.delete(file);
    },
  };
}

// C と D の生成物を両方持つ状態から始める(D への波及を見るため)
const FILES = [
  "/userdata/characters/char-c/pool.json",
  "/userdata/characters/char-c/voices/m-001.wav",
  "/userdata/characters/char-d/pool.json",
  "/userdata/characters/char-d/voices/m-001.wav",
];

function setup(over: { activeCharacterId?: string; generatingId?: string } = {}) {
  const backing = fakeStore({
    characters: [savedCharacter("char-c"), savedCharacter("char-d")],
    ...(over.activeCharacterId !== undefined ? { activeCharacterId: over.activeCharacterId } : {}),
  });
  const store = createAppStore(backing);
  const fs = fakeFs(FILES);
  const onActiveCharacterRemoved = vi.fn();
  const deps = {
    store,
    fs,
    userDataDir: USER_DATA,
    isGenerating: (id: string) => id === over.generatingId,
    onActiveCharacterRemoved,
  };
  return { backing, store, fs, onActiveCharacterRemoved, deps };
}

describe("characterDeletion / キャラクターを削除する", () => {
  it("S0032_06 removes the character from characters and deletes its pool and wav", () => {
    const { store, fs, deps } = setup();

    const deleted = deleteCharacter(deps, "char-c");

    expect(deleted).toEqual({ ok: true });
    expect(store.loadCharacters().map((c) => c.id)).toEqual(["char-d"]);
    expect([...fs.files].filter((p) => p.includes("/char-c/"))).toEqual([]);
  });
});

describe("characterDeletion / 使用中のキャラクターを削除すると定型文に戻る", () => {
  it("S0032_07 clears activeCharacterId and does not activate another character", () => {
    const { store, onActiveCharacterRemoved, deps } = setup({ activeCharacterId: "char-c" });

    deleteCharacter(deps, "char-c");

    expect(store.loadActiveCharacterId()).toBeUndefined();
    // 発動経路へ「使用中が無くなった」と伝える(再起動なしで baseline 定型文になる)
    expect(onActiveCharacterRemoved).toHaveBeenCalledTimes(1);
  });
});

describe("characterDeletion / 生成中のキャラクターは削除できない [否定]", () => {
  it("S0032_08 refuses while the character is generating and changes nothing", () => {
    const { backing, fs, deps } = setup({ generatingId: "char-c" });
    const before = structuredClone(backing.raw);

    const deleted = deleteCharacter(deps, "char-c");

    expect(deleted).toEqual({ ok: false, reason: "generating" });
    expect(backing.raw).toEqual(before);
    expect([...fs.files]).toEqual(FILES);
  });
});

describe("characterDeletion / 削除は他のキャラクターに波及しない [否定]", () => {
  it("S0032_09 leaves the other character, its files and its active state unchanged", () => {
    const { store, fs, onActiveCharacterRemoved, deps } = setup({ activeCharacterId: "char-d" });

    deleteCharacter(deps, "char-c");

    expect(store.loadCharacters()).toEqual([savedCharacter("char-d")]);
    expect([...fs.files].filter((p) => p.includes("/char-d/"))).toEqual([
      "/userdata/characters/char-d/pool.json",
      "/userdata/characters/char-d/voices/m-001.wav",
    ]);
    expect(store.loadActiveCharacterId()).toBe("char-d");
    expect(onActiveCharacterRemoved).not.toHaveBeenCalled();
  });
});

describe("characterDeletion / 生成物の削除に失敗した場合 [異常系]", () => {
  it("S0032_10 reports the failure and keeps the character in characters", () => {
    const { store, fs, deps } = setup({ activeCharacterId: "char-c" });
    fs.removeDirRecursive = () => {
      throw new Error("EBUSY");
    };

    const deleted = deleteCharacter(deps, "char-c");

    expect(deleted).toEqual({ ok: false, reason: "remove-failed" });
    expect(store.loadCharacters().map((c) => c.id)).toEqual(["char-c", "char-d"]);
    expect(store.loadActiveCharacterId()).toBe("char-c");
  });
});
