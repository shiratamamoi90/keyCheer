// 総合(経路): 生成を始めるときの再開 / 作り直しの判定(main/generationStart)から、
// 実際の生成(main/characterCreation)まで通す(論点 0038)。
//
// 単体で縛った分岐(判定の各条件・確認中に何も書かないこと)はここで再検査しない。
// 守るのは結合部の前提:生成側が pool.json に書いた completion と generatedProfile を判定側が読み、
// その結果(resumeFrom の有無)で生成が再開 / 作り直しとして正しく動くこと。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// fs とプロバイダーはインメモリの偽物。実 HTTP・子プロセス・実ファイルは使わない。

import { describe, it, expect } from "vitest";
import { createGenerationRunner } from "../../src/main/characterCreation.js";
import { loadPool, type CharacterFs } from "../../src/main/characterStore.js";
import { resolveGenerationStart } from "../../src/main/generationStart.js";
import { ALL_BUCKET_KEYS } from "../../src/core/messagePool.js";
import type {
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../../src/core/providers/types.js";

const USER_DATA = "/userdata";
const CHAR_ID = "char-regen";
const CHAR_DIR = `${USER_DATA}/characters/${CHAR_ID}`;

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

// 文と画像タグに、要求に入っていたキャラクター名を残す(どのプロフィールで作ったかを見分けるため)
function makeProviders(names: readonly string[]) {
  const nameIn = (prompt: string): string => names.find((n) => prompt.includes(n)) ?? "?";
  const textCalls: string[] = [];
  const text: TextGenerator & ImageTagGenerator = {
    id: "local-ollama",
    generateMessages: async ({ systemPrompt, scenarioKey, count }) => {
      textCalls.push(scenarioKey);
      return Array.from({ length: count }, (_, i) => `${nameIn(systemPrompt)}:${scenarioKey}#${i}`);
    },
    generateImageTags: async ({ prompt }) => ({ tags: [`tag-${nameIn(prompt)}`] }),
  };
  const voice: VoiceSynthesizer = {
    id: "local-voicevox",
    synthesize: async () => new Uint8Array([1]),
  };
  const image: ImageGenerator = {
    id: "stability-ai",
    generateImages: async ({ prompt }) => [new TextEncoder().encode(prompt)],
  };
  return { text, voice, image, textCalls };
}

const CHIA = { name: "チア", personality: "元気", voicevoxSpeakerId: 3 };
const SHIZUKU = { name: "シズク", personality: "丁寧", voicevoxSpeakerId: 3 };

describe("総合: 生成を始めるときの再開 / 作り直し → 生成", () => {
  it("揃ったプールはプロフィールを変えると確認を経て作り直され、古い文・wav・画像が残らない", async () => {
    const fs = fakeFs();
    const providers = makeProviders([CHIA.name, SHIZUKU.name]);
    const runner = createGenerationRunner();
    const run = (
      profile: typeof CHIA,
      resumeFrom?: Parameters<typeof runner.start>[0]["resumeFrom"],
    ) =>
      runner.start({
        characterId: CHAR_ID,
        character: { name: profile.name, personality: profile.personality },
        userDataDir: USER_DATA,
        fs,
        textGenerator: providers.text,
        synthesizer: providers.voice,
        speakerId: profile.voicevoxSpeakerId,
        ...(resumeFrom !== undefined ? { resumeFrom } : {}),
        image: {
          generator: providers.image,
          tagGenerator: providers.text,
          seed: 42,
          width: 512,
          height: 768,
        },
      });

    // --- 1 回目:プールが無いので確認なしで最初から作る
    const first = resolveGenerationStart({
      fs,
      userDataDir: USER_DATA,
      characterId: CHAR_ID,
      profile: CHIA,
      isRebuildConfirmed: false,
    });
    expect(first).toEqual({ kind: "start" });
    expect((await run(CHIA)).ok).toBe(true);
    const oldWavs = Object.keys(fs.files).filter((p) => p.startsWith(`${CHAR_DIR}/voices/`));
    expect(oldWavs.length).toBeGreaterThan(0);

    // --- 保存画面で名前を変えてから生成を始める:確認が要る → 確認すると最初から
    const unconfirmed = resolveGenerationStart({
      fs,
      userDataDir: USER_DATA,
      characterId: CHAR_ID,
      profile: SHIZUKU,
      isRebuildConfirmed: false,
    });
    expect(unconfirmed).toEqual({ kind: "confirmation-required" });
    const confirmed = resolveGenerationStart({
      fs,
      userDataDir: USER_DATA,
      characterId: CHAR_ID,
      profile: SHIZUKU,
      isRebuildConfirmed: true,
    });
    expect(confirmed.kind).toBe("start");
    if (confirmed.kind !== "start") return;
    expect(confirmed.resumeFrom).toBeUndefined();
    expect((await run(SHIZUKU, confirmed.resumeFrom)).ok).toBe(true);

    // 全バケットの文が新しいプロフィールのもの
    const pool = loadPool(fs, USER_DATA, CHAR_ID);
    const texts = ALL_BUCKET_KEYS.flatMap((key) => pool!.buckets[key].map((m) => m.text));
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t.startsWith(`${SHIZUKU.name}:`))).toBe(true);
    // 古い wav は消え、画像は新しいプロフィールで作り直されている
    const wavs = Object.keys(fs.files).filter((p) => p.startsWith(`${CHAR_DIR}/voices/`));
    expect(wavs.length).toBe(texts.length);
    for (const kind of ["idle", "regular", "milestone"]) {
      const bytes = fs.files[`${CHAR_DIR}/images/${kind}.png`] as Uint8Array;
      expect(new TextDecoder().decode(bytes)).toBe(`tag-${SHIZUKU.name}`);
    }
  });

  it("中断したプールは確認なしで再開し、未完了のバケットだけを作る", async () => {
    const fs = fakeFs();
    const providers = makeProviders([CHIA.name]);
    const runner = createGenerationRunner();
    const base = {
      characterId: CHAR_ID,
      character: { name: CHIA.name, personality: CHIA.personality },
      userDataDir: USER_DATA,
      fs,
      textGenerator: providers.text,
      synthesizer: providers.voice,
      speakerId: CHIA.voicevoxSpeakerId,
    };

    // --- 1 回目:5 バケット作ったところで中断する
    const interrupted = await runner.start({
      ...base,
      shouldCancel: () => providers.textCalls.length >= 5,
    });
    expect(interrupted.ok).toBe(false);
    const doneBefore = providers.textCalls.length;

    // --- 生成を始める:確認なしで、保存済みの状態から再開する
    const start = resolveGenerationStart({
      fs,
      userDataDir: USER_DATA,
      characterId: CHAR_ID,
      profile: CHIA,
      isRebuildConfirmed: false,
    });
    expect(start.kind).toBe("start");
    if (start.kind !== "start") return;
    expect(start.resumeFrom).toBeDefined();

    const resumed = await runner.start({ ...base, resumeFrom: start.resumeFrom! });
    expect(resumed.ok).toBe(true);
    // 2 回目に作ったのは未完了だった分だけ
    const resumedCalls = providers.textCalls.slice(doneBefore);
    expect(resumedCalls).toHaveLength(ALL_BUCKET_KEYS.length - doneBefore);
    expect(new Set(resumedCalls).size).toBe(resumedCalls.length);
    expect(providers.textCalls.slice(0, doneBefore).some((k) => resumedCalls.includes(k))).toBe(
      false,
    );
  });
});
