// 総合(経路): local-sdcpp の作り方で、生成 → 待機画像(白の下地から)→ 応援種別の画像 2 枚(待機画像から)→
// 縮小の代わりの画素化 → 背景を透明に → 減色 → 保存、を通す(論点 0045 / 0046)。
//
// 単体で縛った分岐(待機画像の失敗・再開・外部プロバイダー・プロンプトの語)はここで再検査しない。
// 守るのは結合部の前提:生成の流れ → 画像の工程 → sd.cpp の引数と下絵のファイル → 後処理 → 保存 がつながり、
// 保存された 3 枚が「背景が透明・待機画像の色だけ」になっていること。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// sd.cpp は偽の子プロセス(本物の PNG を返す)、fs とプロバイダーはインメモリの偽物、シードは固定。
// PNG の読み書きは計測用の src/eval/png.ts(Node 標準の zlib)を借りる。アプリでは Electron の nativeImage が担う。

import { describe, it, expect } from "vitest";
import {
  createSdcppImageGenerator,
  type ChildHandleLike,
  type SpawnLike,
} from "../../src/agent/providers/localSdcpp.js";
import { createGenerationRunner } from "../../src/main/characterCreation.js";
import type { CharacterFs } from "../../src/main/characterStore.js";
import type { RgbaImage } from "../../src/core/characterImage.js";
import type {
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../../src/core/providers/types.js";
import { decodePng, encodePng } from "../../src/eval/png.js";

const USER_DATA = "/userdata";
const CHAR_ID = "char-local-image";
const SIZE = 8;

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

const text: TextGenerator & ImageTagGenerator = {
  id: "local-ollama",
  generateMessages: async ({ scenarioKey, count }) =>
    Array.from({ length: count }, (_, i) => `${scenarioKey}#${i}`),
  generateImageTags: async ({ prompt }) => ({
    tags: [
      prompt.includes("_milestone_")
        ? "milestone"
        : prompt.includes("_regular_")
          ? "regular"
          : "1girl, idle",
    ],
  }),
};

const voice: VoiceSynthesizer = {
  id: "local-voicevox",
  synthesize: async () => new Uint8Array([1, 2]),
};

// 生成りの背景に、色つきの四角(人物の代わり)を置いた 8x8 の絵。四角の中に背景と同じ色の 1 画素がある
function makePicture(body: readonly [number, number, number]): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const isBody = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      const isEye = x === 3 && y === 3;
      const color = isBody && !isEye ? body : [236, 230, 221];
      pixels.set([...color, 255], (y * SIZE + x) * 4);
    }
  }
  return encodePng({ width: SIZE, height: SIZE, pixels });
}

// 呼ばれた順に、待機画像・regular・milestone の絵を返す。応援種別の絵は待機画像と少し違う色にする
const PICTURES = [
  makePicture([200, 40, 40]),
  makePicture([210, 60, 50]),
  makePicture([180, 30, 60]),
];

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

function opaqueColorsOf(image: RgbaImage): string[] {
  const colors = new Set<string>();
  for (let i = 0; i < image.pixels.length; i += 4) {
    if (image.pixels[i + 3] === 255) {
      colors.add(`${image.pixels[i]},${image.pixels[i + 1]},${image.pixels[i + 2]}`);
    }
  }
  return [...colors].sort();
}

describe("総合: local-sdcpp の作り方でキャラ画像 3 枚を作る", () => {
  it("draws the idle image from the canvas, derives the other two from it and saves them transparent in the idle colors", async () => {
    const fs = fakeFs();
    const spawned: string[][] = [];
    const inputs: Record<string, Uint8Array> = {};
    const spawn: SpawnLike = (_command, args) => {
      const handlers: Record<string, ((arg: unknown) => void)[]> = {};
      const child: ChildHandleLike = {
        on: (event, listener) => {
          (handlers[event] ??= []).push(listener);
        },
        kill: () => {},
      };
      spawned.push(args);
      queueMicrotask(() => handlers["close"]?.forEach((h) => h(0)));
      return child;
    };
    const generator = createSdcppImageGenerator({
      binPath: "/bundled/sd",
      modelPath: "/weights/Counterfeit-V3.0_fix_fp16.safetensors",
      loraPath: "/weights",
      spawn,
      readOutput: () => PICTURES[spawned.length - 1]!,
      makeInputPath: () => `/tmp/sd-in-${spawned.length}.png`,
      writeInput: (path, bytes) => {
        inputs[path] = bytes;
      },
    });
    const canvas = encodePng({
      width: SIZE,
      height: SIZE,
      pixels: new Uint8Array(SIZE * SIZE * 4).fill(255),
    });

    const result = await createGenerationRunner().start({
      characterId: CHAR_ID,
      character: { name: "チア", personality: "元気いっぱい" },
      userDataDir: USER_DATA,
      fs,
      textGenerator: text,
      synthesizer: voice,
      image: {
        generator,
        tagGenerator: text,
        seed: 42,
        width: 512,
        height: 768,
        local: { makeCanvas: () => canvas, decodeScaled: decodePng, encodePng },
      },
    });

    // 生成は完了し、画像の生成元は local-sdcpp と記録される
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completed.image).toBe("local-sdcpp");
    expect(result.images?.missing).toEqual([]);

    // sd.cpp は 3 回起動する。1 回目は白の下地から、2・3 回目は 1 回目が出した絵(後処理の前)から描く
    expect(spawned).toHaveLength(3);
    expect(spawned.map((args) => valueAfter(args, "--strength"))).toEqual(["0.9", "0.65", "0.65"]);
    expect(spawned.map((args) => valueAfter(args, "--steps"))).toEqual(["4", "8", "8"]);
    expect(spawned.map((args) => valueAfter(args, "-s"))).toEqual(["42", "42", "42"]);
    const initImages = spawned.map((args) => inputs[valueAfter(args, "--init-img")!]!);
    expect(Array.from(initImages[0]!)).toEqual(Array.from(canvas));
    expect(Array.from(initImages[1]!)).toEqual(Array.from(PICTURES[0]!));
    expect(Array.from(initImages[2]!)).toEqual(Array.from(PICTURES[0]!));
    expect(valueAfter(spawned[1]!, "-p")).toBe(
      "solo, upper body, simple background, flat color, limited palette, 1girl, idle, regular, <lora:lcm-lora-sdv1-5:1>",
    );

    // 保存された 3 枚:縁の背景は透明、囲まれた背景の色の画素は残り、色は待機画像の色だけ
    const saved = (["idle", "regular", "milestone"] as const).map((kind) =>
      decodePng(fs.files[`${USER_DATA}/characters/${CHAR_ID}/images/${kind}.png`] as Uint8Array),
    );
    const idleColors = opaqueColorsOf(saved[0]!);
    expect(idleColors).toEqual(["200,40,40", "236,230,221"]);
    for (const image of saved) {
      expect(image.pixels[3]).toBe(0);
      expect(image.pixels[(3 * SIZE + 3) * 4 + 3]).toBe(255);
      expect(opaqueColorsOf(image)).toEqual(idleColors);
    }

    // 縮小前の待機画像は残らない
    const leftovers = Object.keys(fs.files).filter(
      (path) =>
        path.startsWith(`${USER_DATA}/characters/${CHAR_ID}/`) &&
        !path.endsWith("/pool.json") &&
        !path.includes("/voices/") &&
        !path.includes("/images/"),
    );
    expect(leftovers).toEqual([]);
  });
});
