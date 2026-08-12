// main/characterCreation: プール生成 → wav 合成 → 永続化のオーケストレーション。
// spec: 論点 0020
// 生成の中身(generatePool / synthesizePoolVoices)は 0002 で実装・テスト済み。
// ここで縛るのは配線・進捗・中断再開・失敗時の扱い・二重起動の防止。
// プロバイダーと fs はすべて注入。実 HTTP も実ファイル書き込みも発生させない。

import { describe, it, expect, vi } from "vitest";
import {
  createGenerationRunner,
  type GenerationProgress,
} from "../../src/main/characterCreation.js";
import { loadPool, type CharacterFs } from "../../src/main/characterStore.js";
import { resolveWavPath } from "../../src/agent/cheerPlayer.js";
import { ALL_BUCKET_KEYS } from "../../src/core/messagePool.js";
import { MESSAGES_PER_BUCKET } from "../../src/agent/poolGenerator.js";
import type { TextGenerator, VoiceSynthesizer } from "../../src/core/providers/types.js";

const USER_DATA = "/userdata";
const CHAR_ID = "chia-abc123";
const character = { name: "チア", personality: "元気いっぱい" };

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

function okText(): TextGenerator {
  return {
    id: "local-ollama",
    generateMessages: vi.fn(async ({ count }) =>
      Array.from({ length: count }, (_, i) => `おうえん${i}`),
    ),
  };
}

function okVoice(): VoiceSynthesizer {
  return { id: "local-voicevox", synthesize: vi.fn(async () => new Uint8Array([1, 2])) };
}

function baseInput(fs: CharacterFs, over: Record<string, unknown> = {}) {
  return {
    characterId: CHAR_ID,
    character,
    userDataDir: USER_DATA,
    fs,
    textGenerator: okText(),
    synthesizer: okVoice(),
    speakerId: 3,
    ...over,
  };
}

describe("characterCreation / ローカル生成でプールと wav が揃う", () => {
  it("S0020_01 saves the pool and one wav per message", async () => {
    const fs = fakeFs();
    const result = await createGenerationRunner().start(baseInput(fs));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const saved = loadPool(fs, USER_DATA, CHAR_ID);
    expect(saved).not.toBeNull();
    expect(Object.keys(saved!.buckets)).toHaveLength(24);

    const expectedTotal = 24 * MESSAGES_PER_BUCKET;
    expect(result.synthesized).toBe(expectedTotal);
    expect(result.missing).toBe(0);

    const wavs = Object.keys(fs.files).filter((p) => p.endsWith(".wav"));
    expect(wavs).toHaveLength(expectedTotal);
    // 発動経路と同じ規約で書かれている
    const firstId = saved!.buckets[ALL_BUCKET_KEYS[0]!]![0]!.id;
    expect(wavs).toContain(resolveWavPath(USER_DATA, CHAR_ID, firstId));
  });
});

describe("characterCreation / 生成の進捗が通知される", () => {
  it("S0020_02 reports both the text phase and the voice phase", async () => {
    const fs = fakeFs();
    const progress: GenerationProgress[] = [];
    await createGenerationRunner().start(
      baseInput(fs, { onProgress: (p: GenerationProgress) => progress.push(p) }),
    );

    const phases = new Set(progress.map((p) => p.phase));
    expect(phases).toEqual(new Set(["text", "voice"]));

    const lastText = progress.filter((p) => p.phase === "text").at(-1);
    expect(lastText).toEqual({ phase: "text", done: 24, total: 24 });

    const lastVoice = progress.filter((p) => p.phase === "voice").at(-1);
    const total = 24 * MESSAGES_PER_BUCKET;
    expect(lastVoice).toEqual({ phase: "voice", done: total, total });
  });
});

describe("characterCreation / Ollama 未起動で生成を開始した [異常系]", () => {
  it("S0020_03 fails without synthesizing anything and without a usable pool", async () => {
    const fs = fakeFs();
    const synthesizer = okVoice();
    const textGenerator: TextGenerator = {
      id: "local-ollama",
      generateMessages: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    };

    const result = await createGenerationRunner().start(
      baseInput(fs, { textGenerator, synthesizer }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("text-generation-failed");
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
    expect(Object.keys(fs.files).filter((p) => p.endsWith(".wav"))).toHaveLength(0);
  });
});

describe("characterCreation / VOICEVOX 未起動で音声だけ失敗した [異常系]", () => {
  it("S0020_04 still saves the pool so cheers use pool text without audio", async () => {
    const fs = fakeFs();
    const synthesizer: VoiceSynthesizer = {
      id: "local-voicevox",
      synthesize: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    };

    const result = await createGenerationRunner().start(baseInput(fs, { synthesizer }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.synthesized).toBe(0);
    expect(result.missing).toBe(24 * MESSAGES_PER_BUCKET);
    expect(loadPool(fs, USER_DATA, CHAR_ID)).not.toBeNull();
    expect(Object.keys(fs.files).filter((p) => p.endsWith(".wav"))).toHaveLength(0);
  });
});

describe("characterCreation / 音声の部分失敗を許容する [境界]", () => {
  it("S0020_05 counts the failures as missing and still completes", async () => {
    const fs = fakeFs();
    let n = 0;
    const synthesizer: VoiceSynthesizer = {
      id: "local-voicevox",
      synthesize: vi.fn(async () => {
        n += 1;
        if (n % 10 === 0) throw new Error("synthesis failed");
        return new Uint8Array([1]);
      }),
    };

    const result = await createGenerationRunner().start(baseInput(fs, { synthesizer }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = 24 * MESSAGES_PER_BUCKET;
    expect(result.missing).toBeGreaterThan(0);
    expect(result.synthesized + result.missing).toBe(total);
  });
});

describe("characterCreation / 生成を中断して再開する", () => {
  it("S0020_06 keeps partial results and resumes only the unfinished buckets", async () => {
    const fs = fakeFs();
    let bucketCalls = 0;
    const textGenerator: TextGenerator = {
      id: "local-ollama",
      generateMessages: vi.fn(async ({ count }) => {
        bucketCalls += 1;
        return Array.from({ length: count }, (_, i) => `m${i}`);
      }),
    };

    const first = await createGenerationRunner().start(
      baseInput(fs, { textGenerator, shouldCancel: () => bucketCalls >= 5 }),
    );
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.reason).toBe("cancelled");
    const doneInFirstPass = bucketCalls;
    expect(doneInFirstPass).toBeLessThan(24);

    // 再開:complete のバケットは作り直さない
    const second = await createGenerationRunner().start(
      baseInput(fs, { textGenerator, resumeFrom: first.state }),
    );
    expect(second.ok).toBe(true);
    expect(bucketCalls).toBe(24);
  });
});

describe("characterCreation / 生成中に再度生成を開始できない [境界]", () => {
  it("S0020_07 refuses a second start while one is in flight", async () => {
    const fs = fakeFs();
    const runner = createGenerationRunner();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const textGenerator: TextGenerator = {
      id: "local-ollama",
      generateMessages: vi.fn(async ({ count }) => {
        await gate;
        return Array.from({ length: count }, (_, i) => `m${i}`);
      }),
    };

    const running = runner.start(baseInput(fs, { textGenerator }));
    expect(runner.isRunning()).toBe(true);

    const second = await runner.start(baseInput(fs));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already-running");

    release!();
    await running;
    expect(runner.isRunning()).toBe(false);
  });
});
