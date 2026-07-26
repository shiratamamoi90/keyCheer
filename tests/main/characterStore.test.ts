// main/characterStore: pool.json と wav の永続化。
// spec: changes/0011-pool-generation-and-playback/spec.md
// fs は注入。テストは実ファイルを書かない。wav パスの解決は発動経路と同じ
// resolveWavPath に委ねる(生成側で別の規約を作らない)。

import { describe, it, expect } from "vitest";
import {
  poolPath,
  characterDir,
  loadPool,
  savePool,
  createWavWriter,
  clearVoices,
  type CharacterFs,
} from "../../src/main/characterStore.js";
import { resolveWavPath } from "../../src/agent/cheerPlayer.js";
import { ALL_BUCKET_KEYS } from "../../src/engine/messagePool.js";
import { emptyPoolState } from "../../src/agent/poolGenerator.js";

const USER_DATA = "/userdata";
const CHAR_ID = "chia-abc123";

function fakeFs(initial: Record<string, string | Uint8Array> = {}): CharacterFs & {
  files: Record<string, string | Uint8Array>;
  dirs: string[];
  removed: string[];
} {
  const files: Record<string, string | Uint8Array> = { ...initial };
  const dirs: string[] = [];
  const removed: string[] = [];
  return {
    files,
    dirs,
    removed,
    exists: (p) => p in files,
    readFile: (p) => (typeof files[p] === "string" ? (files[p] as string) : undefined),
    writeFile: (p, data) => {
      files[p] = data;
    },
    mkdirRecursive: (p) => {
      dirs.push(p);
    },
    removeDirRecursive: (p) => {
      removed.push(p);
      for (const key of Object.keys(files)) {
        if (key.startsWith(`${p}/`)) delete files[key];
      }
    },
  };
}

function completeState() {
  const state = emptyPoolState(CHAR_ID);
  for (const key of ALL_BUCKET_KEYS) {
    state.pool.buckets[key] = [{ id: `${key}-000`, text: "がんばれ" }];
    state.completion[key] = "complete";
  }
  return state;
}

describe("characterStore / 保存先のパス契約 [境界]", () => {
  it("puts pool.json under characters/{characterId}", () => {
    expect(poolPath(USER_DATA, CHAR_ID)).toBe("/userdata/characters/chia-abc123/pool.json");
  });

  it("resolves the character directory consistently", () => {
    expect(characterDir(USER_DATA, CHAR_ID)).toBe("/userdata/characters/chia-abc123");
  });

  it("writes wav to the same path the cheer path reads (resolveWavPath と一本化)", async () => {
    const fs = fakeFs();
    const write = createWavWriter(fs, USER_DATA, CHAR_ID);

    await write("fast_regular_evening-000", new Uint8Array([1, 2, 3]));

    const expected = resolveWavPath(USER_DATA, CHAR_ID, "fast_regular_evening-000");
    expect(Object.keys(fs.files)).toContain(expected);
    expect(Array.from(fs.files[expected] as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("creates the voices directory before writing", async () => {
    const fs = fakeFs();
    await createWavWriter(fs, USER_DATA, CHAR_ID)("m-000", new Uint8Array([1]));
    expect(fs.dirs).toContain("/userdata/characters/chia-abc123/voices");
  });
});

describe("characterStore / ローカル生成でプールと wav が揃う", () => {
  it("saves the pool and its completion so a reload returns it", () => {
    const fs = fakeFs();
    const state = completeState();

    savePool(fs, USER_DATA, CHAR_ID, state);

    const raw = fs.files[poolPath(USER_DATA, CHAR_ID)] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.characterId).toBe(CHAR_ID);
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.buckets as object)).toHaveLength(24);
    // 中断・再開のために completion も残す(specs/data-model.md)
    expect(parsed.completion).toBeDefined();

    expect(loadPool(fs, USER_DATA, CHAR_ID)?.characterId).toBe(CHAR_ID);
  });

  it("creates the character directory before writing the pool", () => {
    const fs = fakeFs();
    savePool(fs, USER_DATA, CHAR_ID, completeState());
    expect(fs.dirs).toContain(characterDir(USER_DATA, CHAR_ID));
  });
});

describe("characterStore / pool.json が存在しない場合", () => {
  it("returns null instead of throwing", () => {
    expect(loadPool(fakeFs(), USER_DATA, CHAR_ID)).toBeNull();
  });
});

describe("characterStore / 壊れた pool.json を読んだ場合 [異常系]", () => {
  it("returns null for malformed JSON", () => {
    const fs = fakeFs({ [poolPath(USER_DATA, CHAR_ID)]: "{ not json" });
    expect(loadPool(fs, USER_DATA, CHAR_ID)).toBeNull();
  });

  it("returns null when the bucket contract is not satisfied", () => {
    const fs = fakeFs({
      [poolPath(USER_DATA, CHAR_ID)]: JSON.stringify({
        characterId: CHAR_ID,
        version: 1,
        buckets: { fast_regular_evening: [{ id: "x", text: "y" }] }, // 24 個揃っていない
      }),
    });
    expect(loadPool(fs, USER_DATA, CHAR_ID)).toBeNull();
  });

  it("returns null when a message is not shaped as {id,text}", () => {
    const state = completeState();
    const broken = JSON.parse(JSON.stringify(state.pool)) as {
      buckets: Record<string, unknown>;
    };
    broken.buckets[ALL_BUCKET_KEYS[0]!] = [{ id: 1, text: null }];
    const fs = fakeFs({ [poolPath(USER_DATA, CHAR_ID)]: JSON.stringify(broken) });
    expect(loadPool(fs, USER_DATA, CHAR_ID)).toBeNull();
  });
});

describe("characterStore / 既にプールがある状態で再生成", () => {
  it("removes the previous voices directory (古い wav は削除)", () => {
    const stale = resolveWavPath(USER_DATA, CHAR_ID, "old-000");
    const fs = fakeFs({ [stale]: new Uint8Array([9]) });

    clearVoices(fs, USER_DATA, CHAR_ID);

    expect(fs.removed).toContain("/userdata/characters/chia-abc123/voices");
    expect(Object.keys(fs.files)).not.toContain(stale);
  });
});

// spec: changes/0011-pool-generation-and-playback/spec.md
//   「Ollama 未起動で生成を開始した [異常系] — pool.json は完成扱いにせず、応援は baseline のまま」
// 生成失敗時も部分結果は再開のために保存する。その結果 24 バケットすべてが空の
// pool.json が残りうるが、これは「使えるプール」ではないため読み込み時に弾く。
// (1 文でもあれば有効 — 中断・再開の途中経過は活かす)
describe("characterStore / 中身が空のプールは無効として扱う [境界]", () => {
  it("returns null when every bucket is empty", () => {
    const state = emptyPoolState(CHAR_ID);
    const fs = fakeFs();
    savePool(fs, USER_DATA, CHAR_ID, state);
    expect(loadPool(fs, USER_DATA, CHAR_ID)).toBeNull();
  });

  it("returns the pool when at least one message exists (中断の途中経過は活かす)", () => {
    const state = emptyPoolState(CHAR_ID);
    state.pool.buckets[ALL_BUCKET_KEYS[0]!] = [{ id: "x-000", text: "がんばれ" }];
    state.completion[ALL_BUCKET_KEYS[0]!] = "complete";
    const fs = fakeFs();
    savePool(fs, USER_DATA, CHAR_ID, state);
    expect(loadPool(fs, USER_DATA, CHAR_ID)).not.toBeNull();
  });
});
