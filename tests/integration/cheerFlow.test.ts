// 総合(経路): キャラ作成の一括生成 → pool.json + wav の永続化 → 起動時ロード →
// 打鍵 → 発動 → ポップアップ表示 → 履歴・統計の永続化 までを 1 本で通す。
//
// 単体で既に縛った分岐(選択規則・ゾーン分類・トリガー判定・パス解決)はここで再検査しない。
// ここが守るのは**結合部の前提**:生成側が書いた wav を発動側が同じ規約で読めること、
// core ← app の依存方向を通した呼び出しが成立すること、発動経路が外部送信を起こさないこと。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// 非決定性はすべて注入して固定する(乱数はシード固定、時刻は定数、fs と
// プロバイダーはインメモリの偽物)。実 HTTP も実ファイル書き込みも発生させない。

import { describe, it, expect, vi } from "vitest";
import { createGenerationRunner } from "../../src/main/characterCreation.js";
import { loadPool, type CharacterFs } from "../../src/main/characterStore.js";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import { createProviderStore } from "../../src/main/providerStore.js";
import { createCheerRuntime } from "../../src/main/cheerRuntime.js";
import { resolveWavPath } from "../../src/agent/cheerPlayer.js";
import { bucketKey } from "../../src/core/messagePool.js";
import { showCheer, tick, initialPopupState } from "../../src/renderer/popupView.js";
import type { TextGenerator, VoiceSynthesizer } from "../../src/core/providers/types.js";
import type { CheerFiredPayload } from "../../src/core/shared/ipc.js";

const USER_DATA = "/userdata";
const CHAR_ID = "char-integration";
const CHARACTER = { name: "チア", personality: "元気いっぱい" };
const POPUP_DURATION_MS = 5000;
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"

// 2026-07-25 10:00:00 ローカル時刻(morning)。ローカル時で作るのは
// timeOfDay がローカル時基準のため(UTC で作ると JST 以外で朝にならない)。
const T0 = new Date(2026, 6, 25, 10, 0, 0).getTime();
const DAY_KEY = "2026-07-25";

// 再現可能な擬似乱数(mulberry32)。シードを固定しないと選ばれる文が毎回変わり、
// 落ちたときに経路の問題か選択の揺れか切り分けられない(不変条件: 再現性)。
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

// 読んだキーを記録する:発動経路が providers を**読まない**ことを見るため
// (書かれていても参照しない、が要件。値の比較では確かめられない)。
function fakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
  reads: string[];
} {
  const raw: Record<string, unknown> = { ...initial };
  const reads: string[] = [];
  return {
    raw,
    reads,
    get: ((key: string) => {
      reads.push(key);
      return raw[key];
    }) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
  };
}

// バケットキーを本文に埋める:ポップアップに出た文が「どのバケットの生成物か」を
// 経路の出口側から確認できるようにするため(30 文字契約に収まる長さ)。
function fakeTextGenerator(): TextGenerator {
  return {
    id: "local-ollama",
    generateMessages: async ({ scenarioKey, count }) =>
      Array.from({ length: count }, (_, i) => `${scenarioKey}#${i}`),
  };
}

function fakeVoiceSynthesizer(): VoiceSynthesizer {
  return { id: "local-voicevox", synthesize: async () => WAV_BYTES };
}

/** 生成 → 永続化までを実コードで通し、起動時ロードに使う fs を返す。 */
async function generateAndPersist(fs: CharacterFs): Promise<void> {
  const result = await createGenerationRunner().start({
    characterId: CHAR_ID,
    character: CHARACTER,
    userDataDir: USER_DATA,
    fs,
    textGenerator: fakeTextGenerator(),
    synthesizer: fakeVoiceSynthesizer(),
    speakerId: 3,
  });
  expect(result.ok).toBe(true);
}

describe("総合: 生成 → 永続化 → 起動ロード → 打鍵 → ポップアップ", () => {
  it("生成した文言と wav で応援が発動し、履歴と統計が永続化される", async () => {
    const fs = fakeFs();
    await generateAndPersist(fs);

    // --- ここから「次回起動」。生成側のオブジェクトは一切持ち越さず、
    //     永続化されたものだけから発動経路を組み立てる(結合部の前提の検証)。
    const pool = loadPool(fs, USER_DATA, CHAR_ID);
    expect(pool).not.toBeNull();

    const store = createAppStore(fakeStore());
    const { config } = store.loadTriggerConfig();
    const stats = store.loadStats();

    const emitted: CheerFiredPayload[] = [];
    const runtime = createCheerRuntime(
      {
        userDataDir: USER_DATA,
        popupDurationMs: POPUP_DURATION_MS,
        emitCheer: (payload) => emitted.push(payload),
        recordHistory: (entry) => store.appendCheerHistory(entry),
        wavExists: (path) => fs.exists(path),
        recordStats: ({ day, keys, activeSeconds }) => {
          store.recordKeyCount(day, keys);
          if (activeSeconds > 0) store.addActiveSeconds(day, activeSeconds);
        },
        random: seeded(42),
      },
      config,
      { initialCount: stats.totalKeyCount },
    );
    runtime.setActiveCharacter(CHAR_ID, pool);

    // --- 打鍵。既定の regular 間隔ちょうどで 1 回だけ発動する。
    for (let i = 1; i <= config.regular; i++) runtime.handleKeyPress(T0 + i);

    expect(emitted).toHaveLength(1);
    const payload = emitted[0]!;
    expect(payload.count).toBe(config.regular);
    expect(payload.type).toBe("regular");

    // 表示文言が baseline ではなく**生成したプールの文**であること。
    const key = bucketKey(payload.speedZone, payload.type, payload.timeOfDay);
    expect(pool!.buckets[key]).toContainEqual({ id: payload.messageId, text: payload.message });

    // 生成側が書いた wav を、発動側が同じ規約(resolveWavPath)で引けていること。
    const wavPath = resolveWavPath(USER_DATA, CHAR_ID, payload.messageId);
    expect(payload.wavPath).toBe(wavPath);
    expect(fs.files[wavPath]).toEqual(WAV_BYTES);

    // --- renderer 側。main から届いたペイロードだけで表示が決まる。
    const shown = showCheer(initialPopupState, payload, T0);
    expect(shown.state.visible).toBe(true);
    expect(shown.state.text).toBe(payload.message);
    expect(shown.playWavPath).toBe(wavPath);
    expect(tick(shown.state, T0 + POPUP_DURATION_MS).visible).toBe(false);

    // --- 永続化。履歴には表示文言と集計値だけが載る(入力内容は持たない)。
    runtime.flushStats();
    const saved = store.loadStats();
    expect(saved.totalKeyCount).toBe(config.regular);
    expect(saved.dailyCounts[DAY_KEY]).toBe(config.regular);
    expect(saved.cheerHistory).toHaveLength(1);
    expect(saved.cheerHistory[0]?.messageId).toBe(payload.messageId);
  });

  it("キャラ未作成でも発動し、baseline 定型文をテキストのみで出す", () => {
    const store = createAppStore(fakeStore());
    const { config } = store.loadTriggerConfig();
    const emitted: CheerFiredPayload[] = [];
    const runtime = createCheerRuntime(
      {
        userDataDir: USER_DATA,
        popupDurationMs: POPUP_DURATION_MS,
        emitCheer: (payload) => emitted.push(payload),
        recordHistory: (entry) => store.appendCheerHistory(entry),
        wavExists: () => false,
        random: seeded(42),
      },
      config,
    );
    // setActiveCharacter を呼ばない = プール未生成のまま起動した状態。

    for (let i = 1; i <= config.regular; i++) runtime.handleKeyPress(T0 + i);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.message).not.toBe("");
    expect(emitted[0]?.wavPath).toBeNull(); // baseline は wav を事前合成していない
    expect(showCheer(initialPopupState, emitted[0]!, T0).playWavPath).toBeNull();
  });
});

describe("総合: 発動経路は外部と通信しない", () => {
  it("生成物を読み込んだ状態で打鍵しても fetch が 1 度も呼ばれない", async () => {
    // import レベルの分離は tests/main/cheerPathIsolation.test.ts が縛る。
    // ここで見るのは**繋いだ状態で実際に走らせても通信が起きない**こと
    // (プライバシー不変条件:発動経路は localhost を含め一切送信しない)。
    const fs = fakeFs();
    await generateAndPersist(fs);
    const pool = loadPool(fs, USER_DATA, CHAR_ID);
    const store = createAppStore(fakeStore());
    const { config } = store.loadTriggerConfig();

    const runtime = createCheerRuntime(
      {
        userDataDir: USER_DATA,
        popupDurationMs: POPUP_DURATION_MS,
        emitCheer: () => {},
        recordHistory: (entry) => store.appendCheerHistory(entry),
        wavExists: (path) => fs.exists(path),
        random: seeded(42),
      },
      config,
    );
    runtime.setActiveCharacter(CHAR_ID, pool);

    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      // マイルストーンを含む回数まで打つ(発動が複数回起きる経路を通す)
      for (let i = 1; i <= config.milestones[0]!; i++) runtime.handleKeyPress(T0 + i);
      runtime.flushStats();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.loadStats().cheerHistory.length).toBeGreaterThan(1);
  });

  it("外部プロバイダーが選択・保存されていても、発動経路はその設定を読まない", async () => {
    // 応援はプール + wav だけで成立する(CLAUDE.md 不変条件)。
    // 同じ永続化ストアに providers が入っている状態で発動経路を回し、
    // `providers` キーが一度も読まれないことを見る。
    const fs = fakeFs();
    await generateAndPersist(fs);
    const pool = loadPool(fs, USER_DATA, CHAR_ID);

    const raw = fakeStore();
    const store = createAppStore(raw);
    const { config } = store.loadTriggerConfig();
    // キャラ作成側の関心:外部プロバイダーを選び、同意も済ませておく。
    const providers = createProviderStore(raw);
    expect(
      providers.saveProviders({ text: "openai", voice: "openai-tts", image: "openai-dalle" }),
    ).toEqual({ ok: true });
    providers.grantConsent("openai");

    const emitted: CheerFiredPayload[] = [];
    const runtime = createCheerRuntime(
      {
        userDataDir: USER_DATA,
        popupDurationMs: POPUP_DURATION_MS,
        emitCheer: (payload) => emitted.push(payload),
        recordHistory: (entry) => store.appendCheerHistory(entry),
        wavExists: (path) => fs.exists(path),
        recordStats: ({ day, keys }) => store.recordKeyCount(day, keys),
        random: seeded(42),
      },
      config,
    );
    runtime.setActiveCharacter(CHAR_ID, pool);

    raw.reads.length = 0; // ここから先が発動経路の読み取り
    for (let i = 1; i <= config.regular; i++) runtime.handleKeyPress(T0 + i);
    runtime.flushStats();

    expect(emitted).toHaveLength(1); // 外部プロバイダー選択下でも応援は同じように出る
    expect(raw.reads).not.toContain("providers");
    expect(raw.reads).toContain("stats"); // 記録は行われている = 計測が生きている
  });
});
