// 総合(経路): 生成 → 画像の生成記録 → 一覧に 3 枚のパス → 画像だけ作り直す(シード + 1・画像タグは記録のまま)
// → 一覧と記録が新しくなる → 失敗した作り直しでは前の 3 枚が残る(論点 0050)。
// 単体で縛った分岐は再検査しない。総合テストにシナリオ ID は付けない。fs とプロバイダーはインメモリの偽物。

import { describe, expect, it } from "vitest";
import { createGenerationRunner } from "../../src/main/characterCreation.js";
import {
  loadImageGenerationRecord,
  loadPool,
  type CharacterFs,
} from "../../src/main/characterStore.js";
import { loadCharacterList } from "../../src/main/characterSelection.js";
import { createAppStore, type StoreLike } from "../../src/main/store.js";
import { resolveImagePath } from "../../src/agent/cheerPlayer.js";
import { CHARACTER_IMAGE_KINDS } from "../../src/core/characterImage.js";
import { buildImageSlots } from "../../src/renderer/characterImagesView.js";
import type {
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../../src/core/providers/types.js";

const USER_DATA = "/userdata";
const CHAR_ID = "char-img";

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

function fakeStore(raw: Record<string, unknown>): StoreLike {
  return {
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
    delete: ((key: string) => {
      delete raw[key];
    }) as StoreLike["delete"],
  };
}

const kindOf = (prompt: string) =>
  prompt.includes("_milestone_") ? "milestone" : prompt.includes("_regular_") ? "regular" : "idle";

const text: TextGenerator & ImageTagGenerator = {
  id: "local-ollama",
  generateMessages: async ({ scenarioKey, count }) =>
    Array.from({ length: count }, (_, i) => `${scenarioKey}#${i}`),
  // 画像タグにシードを入れる(画像だけ作り直すときに、画像タグを s + 1 で出させ直したかを見るため。論点 0068)
  generateImageTags: async ({ prompt, seed }) => ({ tags: [`tag-${kindOf(prompt)}-s${seed}`] }),
};
const voice: VoiceSynthesizer = {
  id: "local-voicevox",
  synthesize: async () => new Uint8Array([1]),
};

// 絵 = 「画像タグ@シード」。どの画像タグとシードで作ったかが絵から読める
function images(isFailing = false): ImageGenerator {
  return {
    id: "local-sdcpp",
    generateImages: async ({ prompt, seed }) => {
      if (isFailing && prompt.startsWith("tag-regular-")) throw new Error("sd.cpp failed");
      return [new TextEncoder().encode(`${prompt}@${seed}`)];
    },
  };
}

const picture = (fs: ReturnType<typeof fakeFs>, kind: (typeof CHARACTER_IMAGE_KINDS)[number]) =>
  new TextDecoder().decode(fs.files[resolveImagePath(USER_DATA, CHAR_ID, kind)] as Uint8Array);

describe("総合: 生成 → 3 枚の確認 → 画像だけ作り直す", () => {
  it("画像タグを出させ直してシード + 1 で 3 枚が置き換わり、失敗した作り直しでは前の 3 枚が残る", async () => {
    const fs = fakeFs();
    const raw: Record<string, unknown> = {
      characters: [
        { id: CHAR_ID, name: "チア", personality: "元気", imagePaths: {}, voicevoxSpeakerId: 3 },
      ],
    };
    const store = createAppStore(fakeStore(raw));
    const character = { name: "チア", personality: "元気" };
    const runner = createGenerationRunner();
    const imageInput = (generator: ImageGenerator) => ({
      generator,
      tagGenerator: text,
      seed: 42,
      width: 512,
      height: 768,
    });

    // --- 生成(全体)
    const generated = await runner.start({
      characterId: CHAR_ID,
      character,
      userDataDir: USER_DATA,
      fs,
      textGenerator: text,
      synthesizer: voice,
      speakerId: 3,
      image: imageInput(images()),
    });
    expect(generated.ok).toBe(true);
    expect(picture(fs, "regular")).toBe("tag-regular-s42@42");
    expect(loadImageGenerationRecord(fs, USER_DATA, CHAR_ID)?.seed).toBe(42);

    // --- 画面:一覧に 3 枚のパスが載り、3 枚とも出せる
    const list = () =>
      loadCharacterList({
        store,
        loadPool: (id) => loadPool(fs, USER_DATA, id),
        generation: { isGenerating: () => false },
        loadGeneratedProfile: () => undefined,
        loadImagePaths: (id) =>
          Object.fromEntries(
            CHARACTER_IMAGE_KINDS.map((kind) => [
              kind,
              resolveImagePath(USER_DATA, id, kind),
            ]).filter(([, path]) => fs.exists(path as string)),
          ),
      });
    expect(buildImageSlots(list()[0]!.images).every((image) => image.url !== null)).toBe(true);

    // --- 画像だけ作り直す
    const pool = loadPool(fs, USER_DATA, CHAR_ID)!;
    const poolBefore = JSON.stringify(pool);
    const remade = await runner.startImagesOnly({
      characterId: CHAR_ID,
      character,
      pool,
      userDataDir: USER_DATA,
      fs,
      image: imageInput(images()),
    });
    expect(remade).toEqual({ ok: true, completed: { image: "local-sdcpp" } });
    expect(picture(fs, "regular")).toBe("tag-regular-s43@43");
    expect(loadImageGenerationRecord(fs, USER_DATA, CHAR_ID)?.seed).toBe(43);
    expect(loadImageGenerationRecord(fs, USER_DATA, CHAR_ID)?.imageTags.idle).toBe("tag-idle-s43");
    expect(JSON.stringify(loadPool(fs, USER_DATA, CHAR_ID))).toBe(poolBefore);

    // --- 失敗した作り直しでは前の 3 枚と記録が残る
    const failed = await runner.startImagesOnly({
      characterId: CHAR_ID,
      character,
      pool,
      userDataDir: USER_DATA,
      fs,
      image: imageInput(images(true)),
    });
    expect(failed).toEqual({ ok: false, reason: "images-failed" });
    expect(picture(fs, "idle")).toBe("tag-idle-s43@43");
    expect(loadImageGenerationRecord(fs, USER_DATA, CHAR_ID)?.seed).toBe(43);
  });
});
