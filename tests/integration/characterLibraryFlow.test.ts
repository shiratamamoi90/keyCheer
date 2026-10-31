// 総合(経路): 複数のキャラクターの保存 → 生成 → 使用中の切り替え → 応援、と、
// 旧形式の 1 キャラのデータからの移行 → 応援、を通す(論点 0032 / 0033)。
//
// 単体で既に縛った分岐(上限・生成中の拒否・設定の既定値・画面の選別)はここで再検査しない。
// ここが守るのは結合部の前提:store に保存した id で生成物が書かれ、使用中の切り替えが
// 再起動なしで発動経路へ届き、起動時の読み込みでも同じキャラクターで応援が続くこと。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// 乱数はシード固定、時刻は定数、fs・store・プロバイダーはインメモリの偽物。実 HTTP も実ファイルも使わない。

import { describe, it, expect } from "vitest";
import { createGenerationRunner, saveGenerationResult } from "../../src/main/characterCreation.js";
import { loadPool, type CharacterFs } from "../../src/main/characterStore.js";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import { createCheerRuntime } from "../../src/main/cheerRuntime.js";
import { activateCharacter, loadActiveCharacterPool } from "../../src/main/characterSelection.js";
import { resolveWavPath } from "../../src/agent/cheerPlayer.js";
import type { TextGenerator, VoiceSynthesizer } from "../../src/core/providers/types.js";
import type { CheerFiredPayload } from "../../src/core/shared/ipc.js";

const USER_DATA = "/userdata";
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
// 2026-07-25 10:00:00 ローカル時刻(morning)
const T0 = new Date(2026, 6, 25, 10, 0, 0).getTime();

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeFs(): CharacterFs & { files: Record<string, string | Uint8Array> } {
  const files: Record<string, string | Uint8Array> = {};
  return {
    files,
    exists: (p) => p in files,
    readFile: (p) => (typeof files[p] === "string" ? (files[p] as string) : undefined),
    writeFile: (p, d) => {
      files[p] = d;
    },
    mkdirRecursive: () => {},
    removeDirRecursive: (p) => {
      for (const k of Object.keys(files)) if (k.startsWith(`${p}/`)) delete files[k];
    },
  };
}

function fakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
} {
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

// 本文の先頭にキャラクターの印を付ける:ポップアップに出た文が「どのキャラクターの生成物か」を
// 経路の出口側から確かめるため(30 文字契約に収まる長さ)。
function fakeTextGenerator(mark: string): TextGenerator {
  return {
    id: "local-ollama",
    generateMessages: async ({ scenarioKey, count }) =>
      Array.from({ length: count }, (_, i) => `${mark}:${scenarioKey}#${i}`),
  };
}

function fakeVoiceSynthesizer(): VoiceSynthesizer {
  return { id: "local-voicevox", synthesize: async () => WAV_BYTES };
}

function buildRuntime(
  store: ReturnType<typeof createAppStore>,
  fs: CharacterFs,
  emitted: CheerFiredPayload[],
) {
  const { config } = store.loadTriggerConfig();
  const runtime = createCheerRuntime(
    {
      userDataDir: USER_DATA,
      popupDurationMs: 5000,
      emitCheer: (payload) => emitted.push(payload),
      recordHistory: (entry) => store.appendCheerHistory(entry),
      wavExists: (path) => fs.exists(path),
      random: seeded(42),
    },
    config,
  );
  let pressed = 0;
  // 既定の regular 間隔ちょうどまで打鍵して 1 回発動させる
  const cheerOnce = (): CheerFiredPayload => {
    const before = emitted.length;
    for (let i = 0; i < config.regular; i++) {
      pressed += 1;
      runtime.handleKeyPress(T0 + pressed);
    }
    expect(emitted).toHaveLength(before + 1);
    return emitted.at(-1)!;
  };
  return { runtime, cheerOnce };
}

describe("総合: 複数のキャラクター → 生成 → 切り替え → 応援", () => {
  it("使用中を切り替えると、再起動なしで次の応援の文言と wav が切り替えた先のものになる", async () => {
    const fs = fakeFs();
    const backing = fakeStore();
    const store = createAppStore(backing, {
      hasPool: (id) => loadPool(fs, USER_DATA, id) !== null,
    });
    const emitted: CheerFiredPayload[] = [];
    const { runtime, cheerOnce } = buildRuntime(store, fs, emitted);
    const toRuntime = (id: string, pool: Parameters<typeof runtime.setActiveCharacter>[1]) =>
      runtime.setActiveCharacter(id, pool);

    // --- 保存画面:2 件保存する
    const a = store.addCharacter({ name: "A", personality: "元気", voicevoxSpeakerId: 3 });
    const b = store.addCharacter({ name: "B", personality: "冷静", voicevoxSpeakerId: 8 });
    if (!a.ok || !b.ok) throw new Error("保存できなかった");

    // --- 生成画面:A → B の順に生成する(既定では完了したものが使用中になる)
    for (const [id, mark, name] of [
      [a.id, "A", "A"],
      [b.id, "B", "B"],
    ] as const) {
      const result = await createGenerationRunner().start({
        characterId: id,
        character: { name, personality: "p" },
        userDataDir: USER_DATA,
        fs,
        textGenerator: fakeTextGenerator(mark),
        synthesizer: fakeVoiceSynthesizer(),
        speakerId: 3,
      });
      saveGenerationResult(
        {
          store,
          loadPool: (cid) => loadPool(fs, USER_DATA, cid),
          onActiveCharacterChanged: toRuntime,
        },
        id,
        result,
      );
    }
    expect(store.loadActiveCharacterId()).toBe(b.id);
    const fromB = cheerOnce();
    expect(fromB.message.startsWith("B:")).toBe(true);
    expect(fromB.wavPath).toBe(resolveWavPath(USER_DATA, b.id, fromB.messageId));

    // --- 切り替え画面:A を使用中にする
    const activated = activateCharacter(
      {
        store,
        loadPool: (cid) => loadPool(fs, USER_DATA, cid),
        generation: { isGenerating: () => false },
        onActiveCharacterChanged: toRuntime,
      },
      a.id,
    );
    expect(activated).toEqual({ ok: true });

    const fromA = cheerOnce();
    expect(fromA.message.startsWith("A:")).toBe(true);
    expect(fromA.wavPath).toBe(resolveWavPath(USER_DATA, a.id, fromA.messageId));
    expect(fs.files[fromA.wavPath!]).toEqual(WAV_BYTES);

    // --- 次回起動:永続化された JSON と fs だけから、同じ A で応援が続く
    const reloaded = createAppStore(fakeStore(structuredClone(backing.raw)));
    const active = loadActiveCharacterPool({
      store: reloaded,
      loadPool: (cid) => loadPool(fs, USER_DATA, cid),
    });
    expect(active?.characterId).toBe(a.id);
  });
});

describe("総合: 旧形式の 1 キャラのデータ → 移行 → 応援", () => {
  it("単数の character とそのプールがあれば、移行後もそのキャラクターで応援が続く", async () => {
    const fs = fakeFs();
    const legacyId = "char-legacy";
    const generated = await createGenerationRunner().start({
      characterId: legacyId,
      character: { name: "旧", personality: "p" },
      userDataDir: USER_DATA,
      fs,
      textGenerator: fakeTextGenerator("L"),
      synthesizer: fakeVoiceSynthesizer(),
      speakerId: 3,
    });
    expect(generated.ok).toBe(true);

    // 論点 0032 より前の形で保存された設定
    const backing = fakeStore({
      character: {
        id: legacyId,
        name: "旧",
        personality: "p",
        imagePaths: {},
        voicevoxSpeakerId: 3,
      },
    });
    const store = createAppStore(backing, {
      hasPool: (id) => loadPool(fs, USER_DATA, id) !== null,
    });
    const emitted: CheerFiredPayload[] = [];
    const { runtime, cheerOnce } = buildRuntime(store, fs, emitted);

    // index.ts の起動時の紐付けと同じ受け渡し
    const active = loadActiveCharacterPool({
      store,
      loadPool: (cid) => loadPool(fs, USER_DATA, cid),
    });
    runtime.setActiveCharacter(active?.characterId ?? null, active?.pool ?? null);

    const payload = cheerOnce();
    expect(payload.message.startsWith("L:")).toBe(true);
    expect(payload.wavPath).toBe(resolveWavPath(USER_DATA, legacyId, payload.messageId));
    expect(backing.raw.character).toBeUndefined();
    expect(store.loadCharacters().map((c) => c.id)).toEqual([legacyId]);
  });
});
