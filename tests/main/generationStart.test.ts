// main/generationStart: 保存されている pool.json から、生成をどう始めるか(再開 / 作り直し / 確認)を決める。
// 要件: docs/pool-generation.md「生成を始めたときに、再開するか作り直すかを決める」/
//       docs/main-window.md「作り直しになるときは、生成を始める前に確認する」(論点 0038)
// fs は注入。実ファイルを書かない。

import { describe, it, expect } from "vitest";
import { resolveGenerationStart } from "../../src/main/generationStart.js";
import { poolPath, savePool, type CharacterFs } from "../../src/main/characterStore.js";
import { emptyPoolState, type PoolGenerationState } from "../../src/agent/poolGenerator.js";
import { ALL_BUCKET_KEYS } from "../../src/core/messagePool.js";

const USER_DATA = "/userdata";
const CHAR_ID = "chia-abc123";
const PROFILE = { name: "チアちゃん", personality: "元気いっぱい", voicevoxSpeakerId: 3 };

function fakeFs(): CharacterFs & {
  files: Record<string, string | Uint8Array>;
  writes: string[];
  removed: string[];
} {
  const files: Record<string, string | Uint8Array> = {};
  const writes: string[] = [];
  const removed: string[] = [];
  return {
    files,
    writes,
    removed,
    exists: (p) => p in files,
    readFile: (p) => (typeof files[p] === "string" ? (files[p] as string) : undefined),
    writeFile: (p, data) => {
      writes.push(p);
      files[p] = data;
    },
    mkdirRecursive: () => {},
    removeDirRecursive: (p) => {
      removed.push(p);
      for (const key of Object.keys(files)) {
        if (key.startsWith(`${p}/`)) delete files[key];
      }
    },
  };
}

// 全バケットに 1 文ずつ入れ、unfinished に挙げたバケットだけ pending にする
function makeState(unfinished: readonly string[] = []): PoolGenerationState {
  const state = emptyPoolState(CHAR_ID);
  for (const key of ALL_BUCKET_KEYS) {
    if (unfinished.includes(key)) {
      state.completion[key] = "pending";
      continue;
    }
    state.pool.buckets[key] = [{ id: `${key}-000`, text: "がんばれ" }];
    state.completion[key] = "complete";
  }
  return state;
}

// GIVEN を組み立てたあと、判定の前後で書き込みを見分けるために記録を空にする
function seededFs(state: PoolGenerationState, withImages = true) {
  const fs = fakeFs();
  savePool(fs, USER_DATA, CHAR_ID, state, PROFILE);
  fs.files[`${USER_DATA}/characters/${CHAR_ID}/voices/fast_regular_night-000.wav`] = new Uint8Array(
    [1],
  );
  if (withImages) {
    for (const kind of ["idle", "regular", "milestone"]) {
      fs.files[`${USER_DATA}/characters/${CHAR_ID}/images/${kind}.png`] = new Uint8Array([2]);
    }
  }
  fs.writes.length = 0;
  return fs;
}

function startOf(fs: CharacterFs, isRebuildConfirmed: boolean, profile = PROFILE) {
  return resolveGenerationStart({
    fs,
    userDataDir: USER_DATA,
    characterId: CHAR_ID,
    profile,
    isRebuildConfirmed,
  });
}

describe("generationStart / プールが無い・読めないなら最初から作る [異常系]", () => {
  it("S0038_05 starts from scratch without confirmation when pool.json is missing or unreadable", () => {
    const broken: Record<string, string | undefined> = {
      missing: undefined,
      "broken json": "{ not json",
      "no completion": JSON.stringify({ buckets: makeState().pool.buckets }),
    };
    for (const [label, raw] of Object.entries(broken)) {
      // GIVEN pool.json が無い / 壊れている / completion を読めない
      const fs = fakeFs();
      if (raw !== undefined) fs.files[poolPath(USER_DATA, CHAR_ID)] = raw;

      // WHEN 生成を始める(確認はしていない)
      const start = startOf(fs, false);

      // THEN クラッシュせず、再開の状態を持たずに最初から始める
      expect(start, label).toEqual({ kind: "start" });
    }
  });
});

describe("generationStart / 画像だけが欠けていても、テキストが揃っていれば作り直す [境界]", () => {
  it("S0038_06 treats a complete pool with missing images as a rebuild", () => {
    // GIVEN 全バケットが complete で、画像が 1 枚も無い
    const fs = seededFs(makeState(), false);

    // WHEN 確認済みで生成を始める
    const start = startOf(fs, true);

    // THEN 欠けた画像だけを作るのではなく、作り直す(再開の状態を渡さない)
    expect(start).toEqual({ kind: "start" });
  });
});

describe("generationStart / 作り直しになるときは、生成を始める前に確認する", () => {
  it("S0038_07 requires confirmation before rebuilding an existing pool, and rebuilds once confirmed", () => {
    // GIVEN 全バケットが揃ったプール / 未完了だが生成後にプロフィールを変えたプール
    const cases = [
      { label: "complete", fs: seededFs(makeState()), profile: PROFILE },
      {
        label: "profile changed",
        fs: seededFs(makeState(["slow_regular_morning"])),
        profile: { ...PROFILE, name: "シズク" },
      },
    ];
    for (const { label, fs, profile } of cases) {
      // WHEN 確認なしで始める / 確認してから始める
      const unconfirmed = startOf(fs, false, profile);
      const confirmed = startOf(fs, true, profile);

      // THEN 確認なしでは確認を求め、確認したら再開の状態を渡さずに始める(= 作り直し)
      expect(unconfirmed, label).toEqual({ kind: "confirmation-required" });
      expect(confirmed, label).toEqual({ kind: "start" });
    }
  });
});

describe("generationStart / 確認で取りやめたら何も変えない [否定]", () => {
  it("S0038_08 leaves the pool, wav and images untouched while asking for confirmation", () => {
    // GIVEN 全バケットが揃い、wav と画像があるキャラクター
    const fs = seededFs(makeState());
    const before = structuredClone(fs.files);

    // WHEN 確認を求めた(取りやめれば呼び直さない)
    const start = startOf(fs, false);

    // THEN 何も書かず、何も消さない
    expect(start).toEqual({ kind: "confirmation-required" });
    expect(fs.writes).toEqual([]);
    expect(fs.removed).toEqual([]);
    expect(fs.files).toEqual(before);
  });
});

describe("generationStart / 再開と初めての生成では確認を出さない [否定]", () => {
  it("S0038_09 starts without confirmation when resuming or when there is no pool", () => {
    // GIVEN 未完了のバケットが残り、プロフィールを変えていない
    const state = makeState(["fast_milestone_night"]);
    const resumable = seededFs(state);

    // WHEN 確認なしで始める
    const resumed = startOf(resumable, false);

    // THEN 確認を求めず、保存済みの状態から再開する
    expect(resumed.kind).toBe("start");
    if (resumed.kind !== "start") return;
    expect(resumed.resumeFrom?.completion).toEqual(state.completion);
    expect(resumed.resumeFrom?.pool.buckets).toEqual(state.pool.buckets);

    // GIVEN プールが無い / WHEN 確認なしで始める / THEN 確認を求めずに最初から始める
    expect(startOf(fakeFs(), false)).toEqual({ kind: "start" });
  });
});
