import { describe, it, expect } from "vitest";
import {
  generatePool,
  emptyPoolState,
  isPoolComplete,
  MAX_MESSAGE_LENGTH,
  MESSAGES_PER_BUCKET,
} from "../../src/agent/poolGenerator.js";
import { ALL_BUCKET_KEYS } from "../../src/core/messagePool.js";
import type { TextGenerator, TextGenerationRequest } from "../../src/core/providers/types.js";

// 要件: docs/integrations.md(テキスト: プール一括生成成功 / 生成途中の中断と再開 /
//        一括生成中の進捗 UX / 文字数契約 [境界] / Ollama 未起動のフォールバック [異常系])
// 生成品質は測らない(→ 非決定的な論点(decisions/))。契約・クラッシュしない・再開可能性のみ縛る。

const character = { name: "チアちゃん", personality: "元気いっぱい" };

function makeGenerator(
  impl: (req: TextGenerationRequest) => Promise<string[]>,
): TextGenerator & { calls: TextGenerationRequest[] } {
  const calls: TextGenerationRequest[] = [];
  return {
    id: "local-ollama",
    calls,
    generateMessages: async (req) => {
      calls.push(req);
      return impl(req);
    },
  };
}

describe("poolGenerator / プール一括生成成功", () => {
  it("S0016_14 generates 24 buckets x MESSAGES_PER_BUCKET messages, addressable by scenario key", async () => {
    const generator = makeGenerator(async ({ count }) =>
      Array.from({ length: count }, (_, i) => `msg${i}`),
    );
    const progress: number[] = [];
    const state = await generatePool({
      characterId: "test-char",
      character,
      generator,
      onProgress: (done, total) => progress.push(done * 1000 + total),
    });

    expect(isPoolComplete(state)).toBe(true);
    expect(Object.keys(state.pool.buckets)).toHaveLength(24);
    let total = 0;
    for (const key of ALL_BUCKET_KEYS) {
      expect(state.completion[key]).toBe("complete");
      expect(state.pool.buckets[key]).toHaveLength(MESSAGES_PER_BUCKET);
      total += state.pool.buckets[key].length;
    }
    expect(total).toBe(24 * MESSAGES_PER_BUCKET);
    // 既定値は 8(= 192 文)。20(= 480 文)から引き下げた根拠は
    // decisions/0007 と 論点 0020 を参照(作成時間とディスク使用量)。
    expect(MESSAGES_PER_BUCKET).toBe(8);
    // シナリオごとに 1 回ずつ呼ばれ、scenarioKey が渡る
    expect(generator.calls).toHaveLength(24);
    expect(new Set(generator.calls.map((c) => c.scenarioKey))).toEqual(new Set(ALL_BUCKET_KEYS));
    // 進捗は 24 回、最後は 24/24
    expect(progress).toHaveLength(24);
    expect(progress[progress.length - 1]).toBe(24 * 1000 + 24);
  });

  it("assigns unique, Windows-safe message ids (used as wav filenames)", async () => {
    const generator = makeGenerator(async ({ count }) =>
      Array.from({ length: count }, (_, i) => `m${i}`),
    );
    const state = await generatePool({ characterId: "c", character, generator });
    const ids = ALL_BUCKET_KEYS.flatMap((k) => state.pool.buckets[k].map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/); // ファイル名に安全(: / \ 等を含まない)
    }
  });
});

describe("poolGenerator / 文字数契約 [境界]", () => {
  it("S0016_17 truncates messages longer than 30 characters (code points)", async () => {
    const long = "あ".repeat(45);
    const generator = makeGenerator(async () => [long, "短い文"]);
    const state = await generatePool({ characterId: "c", character, generator });
    for (const key of ALL_BUCKET_KEYS) {
      const texts = state.pool.buckets[key].map((m) => m.text);
      expect(texts[0]).toBe("あ".repeat(MAX_MESSAGE_LENGTH));
      expect(texts[1]).toBe("短い文");
    }
  });

  it("drops empty strings from generator output", async () => {
    const generator = makeGenerator(async () => ["ok", "", "  ", "ok2"]);
    const state = await generatePool({ characterId: "c", character, generator });
    for (const key of ALL_BUCKET_KEYS) {
      expect(state.pool.buckets[key].map((m) => m.text)).toEqual(["ok", "ok2"]);
    }
  });
});

describe("poolGenerator / Ollama (ローカル) 未起動のフォールバック [異常系]", () => {
  it("S0016_18 does not crash; marks buckets failed and pool stays incomplete", async () => {
    const generator = makeGenerator(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:11434");
    });
    const state = await generatePool({ characterId: "c", character, generator });
    expect(isPoolComplete(state)).toBe(false); // キャラ作成は完了させない
    for (const key of ALL_BUCKET_KEYS) {
      expect(state.completion[key]).toBe("failed");
      expect(state.pool.buckets[key]).toEqual([]);
    }
  });

  it("treats an all-empty response as failure (no silent empty bucket)", async () => {
    const generator = makeGenerator(async () => []);
    const state = await generatePool({ characterId: "c", character, generator });
    expect(state.completion[ALL_BUCKET_KEYS[0]!]).toBe("failed");
  });
});

describe("poolGenerator / 生成途中の中断と再開", () => {
  it("S0016_15 resume regenerates only pending/failed buckets and keeps completed ones", async () => {
    // 1 回目: 最初の 3 バケットだけ成功、それ以外は失敗
    let callCount = 0;
    const flaky = makeGenerator(async ({ count }) => {
      callCount++;
      if (callCount > 3) throw new Error("down");
      return Array.from({ length: count }, (_, i) => `first-${i}`);
    });
    const firstRun = await generatePool({ characterId: "c", character, generator: flaky });
    const completedKeys = ALL_BUCKET_KEYS.filter((k) => firstRun.completion[k] === "complete");
    const failedKeys = ALL_BUCKET_KEYS.filter((k) => firstRun.completion[k] === "failed");
    expect(completedKeys).toHaveLength(3);
    expect(failedKeys).toHaveLength(21);

    // 2 回目(再開): 全部成功する generator
    const healthy = makeGenerator(async ({ count }) =>
      Array.from({ length: count }, (_, i) => `second-${i}`),
    );
    const resumed = await generatePool({
      characterId: "c",
      character,
      generator: healthy,
      resumeFrom: firstRun,
    });

    expect(isPoolComplete(resumed)).toBe(true);
    // 完了済みバケットは再生成されない(内容が 1 回目のまま)
    for (const k of completedKeys) {
      expect(resumed.pool.buckets[k].map((m) => m.text)).toEqual(
        firstRun.pool.buckets[k].map((m) => m.text),
      );
    }
    // healthy は未完了分(21)しか呼ばれない
    expect(healthy.calls).toHaveLength(21);
    expect(new Set(healthy.calls.map((c) => c.scenarioKey))).toEqual(new Set(failedKeys));
  });
});

describe("poolGenerator / 一括生成中のキャンセル(部分結果の保持)", () => {
  it("stops at cancellation but keeps completed buckets as partial results", async () => {
    let done = 0;
    const generator = makeGenerator(async ({ count }) => {
      done++;
      return Array.from({ length: count }, (_, i) => `m${i}`);
    });
    const state = await generatePool({
      characterId: "c",
      character,
      generator,
      shouldCancel: () => done >= 5, // 5 バケット完了後にキャンセル
    });
    const completed = ALL_BUCKET_KEYS.filter((k) => state.completion[k] === "complete");
    const pending = ALL_BUCKET_KEYS.filter((k) => state.completion[k] === "pending");
    expect(completed).toHaveLength(5);
    expect(pending).toHaveLength(19);
    expect(isPoolComplete(state)).toBe(false);
    // キャンセル後は generator を呼ばない
    expect(generator.calls).toHaveLength(5);
  });
});

describe("poolGenerator / 初期状態", () => {
  it("emptyPoolState has all 24 buckets pending and empty", () => {
    const state = emptyPoolState("char-1");
    expect(state.pool.characterId).toBe("char-1");
    for (const key of ALL_BUCKET_KEYS) {
      expect(state.completion[key]).toBe("pending");
      expect(state.pool.buckets[key]).toEqual([]);
    }
  });
});

// 要件: docs/integrations.md「プール一括生成成功」(24 シナリオ × 8 文 = 192 文)
// プロンプトで件数を指示しても LLM がそのとおり返す保証はない。多く返された場合に
// そのまま採用すると、プール総数・生成時間・ディスク使用量の見積もりが崩れる
// (2026-07-26 の 480 → 192 削減が無意味になる)。
describe("poolGenerator / 要求数を超える応答は切り詰める [境界]", () => {
  it("truncates a bucket to messagesPerBucket when the provider returns more", async () => {
    const generator = makeGenerator(async ({ count }) =>
      Array.from({ length: count + 7 }, (_, i) => `msg${i}`),
    );
    const state = await generatePool({ characterId: "c", character, generator });

    for (const key of ALL_BUCKET_KEYS) {
      expect(state.pool.buckets[key]).toHaveLength(MESSAGES_PER_BUCKET);
    }
    expect(isPoolComplete(state)).toBe(true);
  });

  it("keeps a short bucket as-is (少ない分は失敗にしない)", async () => {
    const generator = makeGenerator(async () => ["ひとつだけ"]);
    const state = await generatePool({ characterId: "c", character, generator });
    expect(state.pool.buckets[ALL_BUCKET_KEYS[0]!]).toHaveLength(1);
    expect(state.completion[ALL_BUCKET_KEYS[0]!]).toBe("complete");
  });

  it("honours an explicit messagesPerBucket override", async () => {
    const generator = makeGenerator(async () => Array.from({ length: 50 }, (_, i) => `m${i}`));
    const state = await generatePool({
      characterId: "c",
      character,
      generator,
      messagesPerBucket: 3,
    });
    expect(state.pool.buckets[ALL_BUCKET_KEYS[0]!]).toHaveLength(3);
  });
});

describe("poolGenerator / 一括生成中の進捗 UX", () => {
  it("S0016_16 onProgress は単調増加し、最後は total に達する", async () => {
    // GIVEN 進捗を記録するコールバック
    const seen: Array<[number, number]> = [];

    // WHEN プールを一括生成する
    const generator = makeGenerator(async ({ count }) =>
      Array.from({ length: count }, (_, i) => `msg${i}`),
    );
    await generatePool({
      characterId: "test-char",
      character,
      generator,
      onProgress: (done, total) => seen.push([done, total]),
    });

    // THEN 進捗は 0 件から始まらず、後戻りせず、total に到達する
    expect(seen.length).toBeGreaterThan(0);
    const totals = new Set(seen.map(([, total]) => total));
    expect(totals.size).toBe(1);
    const dones = seen.map(([done]) => done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(dones.at(-1)).toBe(seen[0]![1]);
  });
});
