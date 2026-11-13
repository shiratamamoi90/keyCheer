// main/characterCreation: プール生成 → wav 合成 → 永続化のオーケストレーション。
// spec: 論点 0020
// 生成の中身(generatePool / synthesizePoolVoices)は 0002 で実装・テスト済み。
// ここで縛るのは配線・進捗・中断再開・失敗時の扱い・二重起動の防止。
// プロバイダーと fs はすべて注入。実 HTTP も実ファイル書き込みも発生させない。

import { describe, it, expect, vi } from "vitest";
import {
  buildImagesSummary,
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
import type { RgbaImage } from "../../src/core/characterImage.js";
import type {
  ImageGenerationRequest,
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../../src/core/providers/types.js";

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

    const expectedTotal = 48; // regular 3 文 × 12 + milestone 1 文 × 12(論点 0037)
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
    const total = 48;
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
    expect(result.missing).toBe(48);
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
    const total = 48;
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

// 生成でキャラ画像も作る(論点 0036)。docs/pool-generation.md / docs/integrations.md「生成元の記録」
// どの画像の要求かを見分けるため、セリフにシナリオキーを入れる(_regular_ / _milestone_ を含む)。
type ImageKind = "idle" | "regular" | "milestone";

function labeledText(): TextGenerator {
  return {
    id: "local-ollama",
    generateMessages: vi.fn(async ({ scenarioKey, count }) =>
      Array.from({ length: count }, (_, i) => `${scenarioKey}#${i}`),
    ),
  };
}

function kindOfTagPrompt(prompt: string): ImageKind {
  if (prompt.includes("_milestone_")) return "milestone";
  if (prompt.includes("_regular_")) return "regular";
  return "idle";
}

function fakeTags(): ImageTagGenerator {
  return {
    id: "local-ollama",
    generateImageTags: vi.fn(async ({ prompt }) => ({ tags: [kindOfTagPrompt(prompt)] })),
  };
}

// 画像タグ = 画像の種類名なので、プロンプトから種類が分かる。bytes[kind] を返し、failing の種類は throw する
function fakeImages(
  bytes: Record<ImageKind, number>,
  failing: ImageKind[] = [],
  id: ImageGenerator["id"] = "local-sdcpp",
): ImageGenerator {
  return {
    id,
    generateImages: vi.fn(async ({ prompt }) => {
      const kind = prompt as ImageKind;
      if (failing.includes(kind)) throw new Error(`${kind} failed`);
      return [new Uint8Array([bytes[kind]])];
    }),
  };
}

function imageInput(generator: ImageGenerator, tagGenerator: ImageTagGenerator = fakeTags()) {
  return { image: { generator, tagGenerator, seed: 42, width: 512, height: 768 } };
}

const BYTES_1 = { idle: 1, regular: 2, milestone: 3 };
const BYTES_2 = { idle: 21, regular: 22, milestone: 23 };

function imagePath(characterId: string, kind: ImageKind): string {
  return `/userdata/characters/${characterId}/images/${kind}.png`;
}

function imageFiles(fs: { files: Record<string, string | Uint8Array> }, characterId = CHAR_ID) {
  return Object.keys(fs.files)
    .filter((p) => p.startsWith(`/userdata/characters/${characterId}/images/`))
    .sort();
}

describe("characterCreation / 生成でプール・wav の後に画像 3 枚を保存する", () => {
  it("S0036_07 saves the pool, the wavs and then the three images", async () => {
    const fs = fakeFs();

    const result = await createGenerationRunner().start(
      baseInput(fs, { textGenerator: labeledText(), ...imageInput(fakeImages(BYTES_1)) }),
    );

    expect(result.ok).toBe(true);
    expect(loadPool(fs, USER_DATA, CHAR_ID)).not.toBeNull();
    expect(Object.keys(fs.files).filter((p) => p.endsWith(".wav"))).toHaveLength(48);
    expect(imageFiles(fs)).toEqual([
      imagePath(CHAR_ID, "idle"),
      imagePath(CHAR_ID, "milestone"),
      imagePath(CHAR_ID, "regular"),
    ]);
  });
});

describe("characterCreation / 進捗に画像の工程が含まれる", () => {
  it("S0036_08 reports the image phase with done / 3", async () => {
    const fs = fakeFs();
    const progress: GenerationProgress[] = [];

    await createGenerationRunner().start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_1)),
        onProgress: (p: GenerationProgress) => progress.push(p),
      }),
    );

    expect(new Set(progress.map((p) => p.phase))).toEqual(new Set(["text", "voice", "image"]));
    expect(progress.at(-1)).toEqual({ phase: "image", done: 3, total: 3 });
  });
});

describe("characterCreation / 画像の一部が失敗しても生成は完了とする [境界]", () => {
  it("S0036_09 completes and keeps the images that were made", async () => {
    const fs = fakeFs();

    const result = await createGenerationRunner().start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_1, ["regular"])),
      }),
    );

    expect(result.ok).toBe(true);
    expect(imageFiles(fs)).toEqual([imagePath(CHAR_ID, "idle"), imagePath(CHAR_ID, "milestone")]);
  });
});

describe("characterCreation / 画像プロバイダーが使えなくても生成は完了とする [異常系]", () => {
  it("S0036_10 completes without images and reports every image as missing", async () => {
    const fs = fakeFs();
    const generator: ImageGenerator = {
      id: "local-sdcpp",
      generateImages: vi.fn(async () => {
        throw new Error("model weights not found");
      }),
    };

    const result = await createGenerationRunner().start(
      baseInput(fs, { textGenerator: labeledText(), ...imageInput(generator) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(imageFiles(fs)).toEqual([]);
    expect(result.images?.missing.slice().sort()).toEqual(["idle", "milestone", "regular"]);
    expect(loadPool(fs, USER_DATA, CHAR_ID)).not.toBeNull();
  });
});

describe("characterCreation / テキストが失敗したら画像に進まない [異常系]", () => {
  it("S0036_11 neither asks for image tags nor generates images", async () => {
    const fs = fakeFs();
    const textGenerator: TextGenerator = {
      id: "local-ollama",
      generateMessages: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    };
    const tagGenerator = fakeTags();
    const generator = fakeImages(BYTES_1);

    const result = await createGenerationRunner().start(
      baseInput(fs, { textGenerator, ...imageInput(generator, tagGenerator) }),
    );

    expect(result.ok).toBe(false);
    expect(tagGenerator.generateImageTags).not.toHaveBeenCalled();
    expect(generator.generateImages).not.toHaveBeenCalled();
  });
});

describe("characterCreation / 中断して再開すると、保存済みの画像は作り直さない", () => {
  it("S0036_12 resumes only the images that were not saved", async () => {
    const fs = fakeFs();
    const runner = createGenerationRunner();
    // 待機画像を保存したところで中断する
    const first = await runner.start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_1)),
        shouldCancel: () => imagePath(CHAR_ID, "idle") in fs.files,
      }),
    );
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(imageFiles(fs)).toEqual([imagePath(CHAR_ID, "idle")]);

    const generator = fakeImages(BYTES_2);
    const second = await runner.start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...imageInput(generator),
        ...(first.state !== undefined ? { resumeFrom: first.state } : {}),
      }),
    );

    expect(second.ok).toBe(true);
    expect(generator.generateImages).toHaveBeenCalledTimes(2);
    expect(Array.from(fs.files[imagePath(CHAR_ID, "idle")] as Uint8Array)).toEqual([1]);
    expect(Array.from(fs.files[imagePath(CHAR_ID, "regular")] as Uint8Array)).toEqual([22]);
    expect(Array.from(fs.files[imagePath(CHAR_ID, "milestone")] as Uint8Array)).toEqual([23]);
  });
});

describe("characterCreation / 再生成で画像も作り直し、前の画像を残さない", () => {
  it("S0036_13 replaces the images and leaves no image from the previous generation", async () => {
    const fs = fakeFs();
    const runner = createGenerationRunner();
    await runner.start(
      baseInput(fs, { textGenerator: labeledText(), ...imageInput(fakeImages(BYTES_1)) }),
    );
    expect(imageFiles(fs)).toHaveLength(3);

    const result = await runner.start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_2, ["milestone"])),
      }),
    );

    expect(result.ok).toBe(true);
    expect(Array.from(fs.files[imagePath(CHAR_ID, "idle")] as Uint8Array)).toEqual([21]);
    expect(Array.from(fs.files[imagePath(CHAR_ID, "regular")] as Uint8Array)).toEqual([22]);
    expect(imagePath(CHAR_ID, "milestone") in fs.files).toBe(false);
  });
});

describe("characterCreation / ほかのキャラクターの画像は変化しない [否定]", () => {
  it("S0036_14 leaves another character's images untouched", async () => {
    const fs = fakeFs();
    fs.files[imagePath("char-d", "idle")] = new Uint8Array([99]);
    fs.files[imagePath("char-d", "milestone")] = new Uint8Array([98]);

    await createGenerationRunner().start(
      baseInput(fs, {
        characterId: "char-c",
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_1, ["milestone"])),
      }),
    );

    expect(imageFiles(fs, "char-d")).toEqual([
      imagePath("char-d", "idle"),
      imagePath("char-d", "milestone"),
    ]);
    expect(Array.from(fs.files[imagePath("char-d", "idle")] as Uint8Array)).toEqual([99]);
    expect(Array.from(fs.files[imagePath("char-d", "milestone")] as Uint8Array)).toEqual([98]);
  });
});

describe("characterCreation / 画像が 3 枚揃ったら image を記録", () => {
  it("S0036_16 records the image provider that made all three images", async () => {
    const fs = fakeFs();
    const { store, deps } = setupResult({});

    const result = await createGenerationRunner().start(
      baseInput(fs, {
        characterId: "char-c",
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_1, [], "stability-ai")),
      }),
    );
    saveGenerationResult(deps, "char-c", result);

    expect(store.loadCharacters()[0]?.generatedBy).toEqual({
      text: "local-ollama",
      voice: "local-voicevox",
      image: "stability-ai",
    });
  });
});

describe("characterCreation / 画像が欠けたら image を記録しない [異常系]", () => {
  it("S0036_17 drops a previously recorded image provider and still records text and voice", async () => {
    const fs = fakeFs();
    const { raw, store } = fakeAppStore({
      characters: [
        { ...savedCharacter("char-c"), generatedBy: { image: "local-sdcpp" } },
        savedCharacter("char-d"),
      ],
    });
    const deps = { store, loadPool: () => null, onActiveCharacterChanged: vi.fn() };

    const result = await createGenerationRunner().start(
      baseInput(fs, {
        characterId: "char-c",
        textGenerator: labeledText(),
        ...imageInput(fakeImages(BYTES_1, ["regular"], "stability-ai")),
      }),
    );
    saveGenerationResult(deps, "char-c", result);

    expect(raw.characters).toBeDefined();
    expect(store.loadCharacters()[0]?.generatedBy).toEqual({
      text: "local-ollama",
      voice: "local-voicevox",
    });
  });
});

// --- ローカル画像生成の作り方(論点 0045 / 0046。docs/integrations.md「ローカル画像生成の作り方」)---

const LOCAL_CANVAS = new Uint8Array([0xca]);

// 呼ばれた順に [first], [first + 1], … を返す(その回の 1 枚目 = 待機画像の、縮小前の絵)
function fakeLocalImages(first: number): ImageGenerator & { calls: ImageGenerationRequest[] } {
  const calls: ImageGenerationRequest[] = [];
  return {
    id: "local-sdcpp",
    calls,
    generateImages: async (req) => {
      calls.push(req);
      return [new Uint8Array([first + calls.length - 1])];
    },
  };
}

// 縁が白、まん中の 1 画素が色つきの 3x3 の絵にする。PNG のかわりに画素をそのまま書く
function localImageInput(generator: ImageGenerator) {
  return {
    image: {
      generator,
      tagGenerator: fakeTags(),
      seed: 42,
      width: 512,
      height: 768,
      local: {
        makeCanvas: () => LOCAL_CANVAS,
        decodeScaled: (bytes: Uint8Array): RgbaImage => {
          const pixels = new Uint8Array(3 * 3 * 4).fill(255);
          pixels.set([bytes[0]!, 0, 0, 255], 4 * 4);
          return { width: 3, height: 3, pixels };
        },
        encodePng: (image: RgbaImage) => Uint8Array.from(image.pixels),
      },
    },
  };
}

function characterFiles(fs: { files: Record<string, string | Uint8Array> }): string[] {
  return Object.keys(fs.files)
    .filter((p) => p.startsWith(`/userdata/characters/${CHAR_ID}/`))
    .sort();
}

function isKeptOutput(path: string): boolean {
  const base = `/userdata/characters/${CHAR_ID}/`;
  return (
    path === `${base}pool.json` ||
    path.startsWith(`${base}voices/`) ||
    path.startsWith(`${base}images/`)
  );
}

async function interruptAfterIdle(fs: ReturnType<typeof fakeFs>) {
  const runner = createGenerationRunner();
  const first = await runner.start(
    baseInput(fs, {
      textGenerator: labeledText(),
      ...localImageInput(fakeLocalImages(1)),
      shouldCancel: () => imagePath(CHAR_ID, "idle") in fs.files,
    }),
  );
  expect(first.ok).toBe(false);
  expect(imageFiles(fs)).toEqual([imagePath(CHAR_ID, "idle")]);
  return { runner, state: first.ok ? undefined : first.state };
}

describe("characterCreation / 再開では残っている縮小前の待機画像を下絵にする", () => {
  it("S0046_17 resumes the cheer images from the kept unprocessed idle image", async () => {
    // GIVEN 画像の工程の途中で中断し、idle が保存されていて、縮小前の待機画像([1])が残っている
    const fs = fakeFs();
    const { runner, state } = await interruptAfterIdle(fs);
    const idleBefore = Array.from(fs.files[imagePath(CHAR_ID, "idle")] as Uint8Array);

    // WHEN 再開する
    const generator = fakeLocalImages(21);
    const second = await runner.start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...localImageInput(generator),
        ...(state !== undefined ? { resumeFrom: state } : {}),
      }),
    );

    // THEN idle は作り直さず、残っている縮小前の待機画像を下絵にして残りの 2 枚を作る
    expect(second.ok).toBe(true);
    expect(generator.calls).toHaveLength(2);
    expect(generator.calls.map((call) => Array.from(call.initImage!))).toEqual([[1], [1]]);
    expect(Array.from(fs.files[imagePath(CHAR_ID, "idle")] as Uint8Array)).toEqual(idleBefore);
    expect(imageFiles(fs)).toHaveLength(3);
  });
});

describe("characterCreation / 縮小前の待機画像が残っていなければ 3 枚とも作り直す [境界]", () => {
  it("S0046_18 remakes all three images when the unprocessed idle image is gone", async () => {
    // GIVEN 画像の工程の途中で中断し、idle は保存されているが、縮小前の待機画像が残っていない
    const fs = fakeFs();
    const { runner, state } = await interruptAfterIdle(fs);
    for (const path of characterFiles(fs)) if (!isKeptOutput(path)) delete fs.files[path];

    // WHEN 再開する
    const generator = fakeLocalImages(21);
    const second = await runner.start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...localImageInput(generator),
        ...(state !== undefined ? { resumeFrom: state } : {}),
      }),
    );

    // THEN 保存済みの画像を下絵にせず、待機画像(下地から)から 3 枚とも作り直す
    expect(second.ok).toBe(true);
    expect(generator.calls).toHaveLength(3);
    expect(generator.calls[0]!.initImage).toBe(LOCAL_CANVAS);
    expect(generator.calls.slice(1).map((call) => Array.from(call.initImage!))).toEqual([
      [21],
      [21],
    ]);
    // まん中の画素(待機画像の色)が、作り直した絵のものになっている
    const idle = fs.files[imagePath(CHAR_ID, "idle")] as Uint8Array;
    expect(Array.from(idle.slice(16, 20))).toEqual([21, 0, 0, 255]);
  });
});

describe("characterCreation / 生成が終わったら縮小前の待機画像を残さない [否定]", () => {
  it("S0046_19 leaves nothing but the pool, the wavs and the three images after the generation ends", async () => {
    // GIVEN local-sdcpp で画像の工程を行う(中断の間は、縮小前の待機画像が残っている)
    const fs = fakeFs();
    const { runner, state } = await interruptAfterIdle(fs);
    expect(characterFiles(fs).some((path) => !isKeptOutput(path))).toBe(true);

    // WHEN 生成が完了で終わる
    const second = await runner.start(
      baseInput(fs, {
        textGenerator: labeledText(),
        ...localImageInput(fakeLocalImages(21)),
        ...(state !== undefined ? { resumeFrom: state } : {}),
      }),
    );

    // THEN 縮小前の待機画像は残らない
    expect(second.ok).toBe(true);
    expect(characterFiles(fs).filter((path) => !isKeptOutput(path))).toEqual([]);
    expect(imageFiles(fs)).toHaveLength(3);
  });
});

describe("characterCreation / 画像の結果を画面へ渡す形にまとめる", () => {
  it("counts the saved images when the image phase ran", () => {
    expect(
      buildImagesSummary({ saved: ["idle"], missing: ["regular", "milestone"] }, null),
    ).toEqual({
      saved: 1,
      total: 3,
      unavailableReason: null,
    });
  });

  it("carries the reason when the image phase did not run", () => {
    expect(buildImagesSummary(undefined, "runtime-not-installed")).toEqual({
      saved: 0,
      total: 3,
      unavailableReason: "runtime-not-installed",
    });
  });
});

describe("characterCreation / 画像の重みが無くても生成は始められる [境界]", () => {
  it("S0042_10 starts and completes without images when the image provider could not be built", async () => {
    // GIVEN local-sdcpp で画像の重みが取得されていない(= 画像プロバイダーを組み立てられず、画像の工程を渡さない)。
    //       テキストと音声は生成できる状態
    const fs = fakeFs();

    // WHEN 生成を始める
    const result = await createGenerationRunner().start(baseInput(fs));

    // THEN 取得の案内で止めずに生成を始め、画像なしで完了する
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toBeUndefined();
    expect(imageFiles(fs)).toEqual([]);
    expect(loadPool(fs, USER_DATA, CHAR_ID)).not.toBeNull();
  });
});
