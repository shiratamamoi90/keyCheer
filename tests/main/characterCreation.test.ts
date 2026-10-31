// main/characterCreation: プール生成 → wav 合成 → 永続化のオーケストレーション。
// spec: 論点 0020
// 生成の中身(generatePool / synthesizePoolVoices)は 0002 で実装・テスト済み。
// ここで縛るのは配線・進捗・中断再開・失敗時の扱い・二重起動の防止。
// プロバイダーと fs はすべて注入。実 HTTP も実ファイル書き込みも発生させない。

import { describe, it, expect, vi } from "vitest";
import {
  createGenerationRunner,
  saveGenerationResult,
  type GenerationProgress,
  type GenerationResult,
} from "../../src/main/characterCreation.js";
import { loadPool, loadGeneratedProfile, type CharacterFs } from "../../src/main/characterStore.js";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import type { MessagePool } from "../../src/core/messagePool.js";
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

// 生成元の記録(論点 0022)。runner は「欠損なく完了した種別」と実際に使ったプロバイダー ID を
// `completed` として返し、保存は呼び出し側(store.recordGeneratedBy)が行う。
// 既定のローカル ID と区別するため、ここでは外部の ID を持つ偽物を使う
// (ID を実装側でベタ書きしていても緑になってしまうのを防ぐ)。
describe("characterCreation / 生成元の記録", () => {
  it("S0022_01 records the text provider once every bucket is generated", async () => {
    const fs = fakeFs();
    const textGenerator: TextGenerator = { ...okText(), id: "anthropic" };

    const result = await createGenerationRunner().start(baseInput(fs, { textGenerator }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completed.text).toBe("anthropic");
  });

  it("S0022_02 records the voice provider when no wav is missing", async () => {
    const fs = fakeFs();
    const synthesizer: VoiceSynthesizer = { ...okVoice(), id: "elevenlabs" };

    const result = await createGenerationRunner().start(baseInput(fs, { synthesizer }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missing).toBe(0);
    expect(result.completed.voice).toBe("elevenlabs");
  });

  it("S0022_03 does not record voice when a wav is missing but still records text", async () => {
    const fs = fakeFs();
    let n = 0;
    const synthesizer: VoiceSynthesizer = {
      id: "elevenlabs",
      synthesize: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new Error("synthesis failed");
        return new Uint8Array([1, 2]);
      }),
    };
    const textGenerator: TextGenerator = { ...okText(), id: "anthropic" };

    const result = await createGenerationRunner().start(
      baseInput(fs, { textGenerator, synthesizer }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missing).toBe(1);
    expect(result.completed).toEqual({ text: "anthropic" });
  });

  it("S0022_07 records no kind when text generation does not complete", async () => {
    const fs = fakeFs();
    const textGenerator: TextGenerator = {
      id: "anthropic",
      generateMessages: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    };

    const result = await createGenerationRunner().start(baseInput(fs, { textGenerator }));

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: "text-generation-failed", completed: {} }),
    );
  });
});

// 生成時のプロフィールの記録(論点 0032。docs/data-model.md「メッセージプール」の generatedProfile)。
// 「生成後に変えた」の判定(core/generatedProfile)が比べる元になる。
describe("characterCreation / 生成時のプロフィールを pool.json に残す", () => {
  it("writes the profile used for generation as generatedProfile", async () => {
    const fs = fakeFs();

    await createGenerationRunner().start(baseInput(fs));

    expect(loadGeneratedProfile(fs, USER_DATA, CHAR_ID)).toEqual({
      name: "チア",
      personality: "元気いっぱい",
      voicevoxSpeakerId: 3,
    });
  });
});

// 複数のキャラクターがあるときの生成(論点 0032)。docs/pool-generation.md
// 生成結果の保存(生成元の記録・使用中の更新)は saveGenerationResult が行う。store は偽物の StoreLike。
function fakeAppStore(initial: Record<string, unknown>) {
  const raw: Record<string, unknown> = { ...initial };
  const backing: StoreLike = {
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
    delete: ((key: string) => {
      delete raw[key];
    }) as StoreLike["delete"],
  };
  return { raw, store: createAppStore(backing) };
}

function savedCharacter(id: string) {
  return { id, name: `名前-${id}`, personality: "元気", imagePaths: {}, voicevoxSpeakerId: 3 };
}

const POOL_C: MessagePool = {
  characterId: "char-c",
  version: 1,
  buckets: {} as MessagePool["buckets"],
};
const POOL_D: MessagePool = {
  characterId: "char-d",
  version: 1,
  buckets: {} as MessagePool["buckets"],
};

const COMPLETED_C: GenerationResult = {
  ok: true,
  pool: POOL_C,
  synthesized: 10,
  missing: 0,
  completed: { text: "local-ollama", voice: "local-voicevox" },
};

// C と D を保存した状態。D は生成済み(プールあり)
function setupResult(over: { activeCharacterId?: string; shouldActivateOnComplete?: boolean }) {
  const { raw, store } = fakeAppStore({
    characters: [savedCharacter("char-c"), savedCharacter("char-d")],
    ...(over.activeCharacterId !== undefined ? { activeCharacterId: over.activeCharacterId } : {}),
    ...(over.shouldActivateOnComplete !== undefined
      ? { generation: { shouldActivateOnComplete: over.shouldActivateOnComplete } }
      : {}),
  });
  const onActiveCharacterChanged = vi.fn();
  const deps = {
    store,
    loadPool: (id: string) => (id === "char-d" ? POOL_D : null),
    onActiveCharacterChanged,
  };
  return { raw, store, onActiveCharacterChanged, deps };
}

describe("characterCreation / 生成は選んだキャラクターに対して行う", () => {
  it("S0032_18 writes only the chosen character's files and generatedBy", async () => {
    const fs = fakeFs();
    fs.files["/userdata/characters/char-d/pool.json"] = "D のプール";
    fs.files["/userdata/characters/char-d/voices/m-001.wav"] = new Uint8Array([9]);
    const { store, deps } = setupResult({});

    const result = await createGenerationRunner().start(baseInput(fs, { characterId: "char-c" }));
    saveGenerationResult(deps, "char-c", result);

    const written = Object.keys(fs.files).filter((p) => !p.includes("/char-d/"));
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((p) => p.startsWith("/userdata/characters/char-c/"))).toBe(true);
    expect(fs.files["/userdata/characters/char-d/pool.json"]).toBe("D のプール");
    expect(
      Array.from(fs.files["/userdata/characters/char-d/voices/m-001.wav"] as Uint8Array),
    ).toEqual([9]);
    expect(store.loadCharacters()[0]?.generatedBy).toEqual({
      text: "local-ollama",
      voice: "local-voicevox",
    });
    expect(store.loadCharacters()[1]).toEqual(savedCharacter("char-d"));
  });
});

describe("characterCreation / 生成が完了したらそのキャラクターを使用中にする", () => {
  it("S0032_19 saves the completed character as active and hands its pool to the cheer path", () => {
    const { store, onActiveCharacterChanged, deps } = setupResult({ activeCharacterId: "char-d" });

    saveGenerationResult(deps, "char-c", COMPLETED_C);

    expect(store.loadActiveCharacterId()).toBe("char-c");
    expect(onActiveCharacterChanged).toHaveBeenCalledWith("char-c", POOL_C);
  });
});

describe("characterCreation / 自動で使用中にしない設定なら使用中を変えない [否定]", () => {
  it("S0032_20 keeps the active character when shouldActivateOnComplete is false", () => {
    const { store, onActiveCharacterChanged, deps } = setupResult({
      activeCharacterId: "char-d",
      shouldActivateOnComplete: false,
    });

    saveGenerationResult(deps, "char-c", COMPLETED_C);

    expect(store.loadActiveCharacterId()).toBe("char-d");
    expect(onActiveCharacterChanged).not.toHaveBeenCalled();
  });
});

describe("characterCreation / 自動で使用中にしない設定でも、使用中が無ければ使用中にする [境界]", () => {
  it("S0032_21 activates the completed character when there is no usable active character", () => {
    // 使用中が無い = 未設定 / 指す先が一覧に無い(どちらも定型文で応援している状態)
    const unset = setupResult({ shouldActivateOnComplete: false });
    const missing = setupResult({
      activeCharacterId: "char-gone",
      shouldActivateOnComplete: false,
    });

    saveGenerationResult(unset.deps, "char-c", COMPLETED_C);
    saveGenerationResult(missing.deps, "char-c", COMPLETED_C);

    expect(unset.store.loadActiveCharacterId()).toBe("char-c");
    expect(missing.store.loadActiveCharacterId()).toBe("char-c");
  });
});

describe("characterCreation / 中断・失敗した生成では使用中を変えない [否定]", () => {
  it("S0032_32 keeps the active character after a cancelled or failed generation", () => {
    const cancelled = setupResult({ activeCharacterId: "char-d" });
    const failed = setupResult({ activeCharacterId: "char-d" });

    saveGenerationResult(cancelled.deps, "char-c", {
      ok: false,
      reason: "cancelled",
      completed: {},
    });
    saveGenerationResult(failed.deps, "char-c", {
      ok: false,
      reason: "text-generation-failed",
      completed: {},
    });

    expect(cancelled.store.loadActiveCharacterId()).toBe("char-d");
    expect(failed.store.loadActiveCharacterId()).toBe("char-d");
    expect(cancelled.onActiveCharacterChanged).not.toHaveBeenCalled();
    expect(failed.onActiveCharacterChanged).not.toHaveBeenCalled();
  });
});
