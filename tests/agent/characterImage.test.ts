// agent/characterImage: 画像タグの要求 → 同じシードで画像 3 枚 → 書き出し、のオーケストレーション。
// 要件: docs/integrations.md「画像」「画像タグの要求」(論点 0036)
// テキスト・画像のプロバイダーと書き出しは注入。実 HTTP も子プロセスも起こさない。

import { describe, it, expect } from "vitest";
import {
  generateCharacterImages,
  type LocalIdleSource,
  type LocalImageProcess,
} from "../../src/agent/characterImage.js";
import type { RgbaImage } from "../../src/core/characterImage.js";
import { ALL_BUCKET_KEYS, type MessagePool } from "../../src/core/messagePool.js";
import type {
  ImageGenerationRequest,
  ImageGenerator,
  ImageTagGenerator,
  ImageTagRequest,
} from "../../src/core/providers/types.js";

const character = { name: "チアちゃん", personality: "元気いっぱい" };

function makePool(): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((key) => [
      key,
      [{ id: `${key}-000`, text: key.includes("_milestone_") ? `M:${key}` : `R:${key}` }],
    ]),
  ) as MessagePool["buckets"];
  return { characterId: "c", version: 1, buckets };
}

// どの画像の要求かを、要求に入ったセリフから見分ける
function kindOf(prompt: string): "idle" | "regular" | "milestone" {
  if (prompt.includes("M:")) return "milestone";
  if (prompt.includes("R:")) return "regular";
  return "idle";
}

function fakeTagGenerator(
  respond: (kind: "idle" | "regular" | "milestone") => unknown = (kind) => ({
    tags: [`${kind}-tag`],
  }),
): ImageTagGenerator & { calls: ImageTagRequest[] } {
  const calls: ImageTagRequest[] = [];
  return {
    id: "local-ollama",
    calls,
    generateImageTags: async (req) => {
      calls.push(req);
      return respond(kindOf(req.prompt));
    },
  };
}

function fakeImageGenerator(
  id: ImageGenerator["id"] = "local-sdcpp",
): ImageGenerator & { calls: ImageGenerationRequest[] } {
  const calls: ImageGenerationRequest[] = [];
  return {
    id,
    calls,
    generateImages: async (req) => {
      calls.push(req);
      return Array.from({ length: req.count }, () => new Uint8Array([req.prompt.length]));
    },
  };
}

function baseInput(over: Record<string, unknown> = {}) {
  const written: { kind: string; bytes: Uint8Array }[] = [];
  return {
    written,
    input: {
      character,
      pool: makePool(),
      tagGenerator: fakeTagGenerator(),
      imageGenerator: fakeImageGenerator(),
      seed: 42,
      width: 512,
      height: 768,
      timeoutMsPerImage: 60_000,
      writeImage: async (kind: string, bytes: Uint8Array) => {
        written.push({ kind, bytes });
      },
      ...over,
    },
  };
}

describe("characterImage / 3 枚生成して終了", () => {
  it("S0016_28 writes the idle, regular and milestone images", async () => {
    // GIVEN 必要資材が揃い、3 枚それぞれの画像タグがある
    const { input, written } = baseInput();

    // WHEN 画像の工程を実行する
    const result = await generateCharacterImages(input);

    // THEN idle / regular / milestone の 3 枚が書き出される
    expect(written.map((w) => w.kind).sort()).toEqual(["idle", "milestone", "regular"]);
    expect(result.saved.slice().sort()).toEqual(["idle", "milestone", "regular"]);
    expect(result.failed).toEqual([]);
  });
});

describe("characterImage / 画像 1 枚につき 1 回、画像タグを要求する", () => {
  it("S0036_01 asks the text provider for image tags 3 times with the right inputs", async () => {
    // GIVEN プール(テキスト)の生成が完了したキャラクター
    const tagGenerator = fakeTagGenerator();
    const { input } = baseInput({ tagGenerator });

    // WHEN 画像の工程に入る
    await generateCharacterImages(input);

    // THEN 3 回要求する。待機画像はプロフィールだけ、応援種別の画像はその種別の全バケットのセリフも入る
    expect(tagGenerator.calls).toHaveLength(3);
    const byKind = Object.fromEntries(tagGenerator.calls.map((c) => [kindOf(c.prompt), c.prompt]));
    for (const prompt of Object.values(byKind)) {
      expect(prompt).toContain("チアちゃん");
      expect(prompt).toContain("元気いっぱい");
    }
    expect(byKind.idle).toBeDefined();
    for (const key of ALL_BUCKET_KEYS.filter((k) => k.includes("_regular_"))) {
      expect(byKind.regular).toContain(`R:${key}`);
    }
    for (const key of ALL_BUCKET_KEYS.filter((k) => k.includes("_milestone_"))) {
      expect(byKind.milestone).toContain(`M:${key}`);
    }
  });
});

describe("characterImage / 画像タグの形式違反はその画像だけ失敗にする [異常系]", () => {
  it("S0036_05 fails only the image whose tag response is malformed and keeps going", async () => {
    const malformed: unknown[] = [
      "not json {",
      { other: ["x"] },
      { tags: "smiling" },
      { tags: ["smiling", 3] },
      { tags: [" ", ""] },
    ];
    for (const bad of malformed) {
      // GIVEN milestone の画像タグの応答だけが形式違反
      const imageGenerator = fakeImageGenerator();
      const tagGenerator = fakeTagGenerator((kind) =>
        kind === "milestone" ? bad : { tags: [`${kind}-tag`] },
      );
      const { input, written } = baseInput({ tagGenerator, imageGenerator });

      // WHEN 画像の工程を実行する
      const result = await generateCharacterImages(input);

      // THEN milestone の画像は作らず失敗、ほかの 2 枚は作る
      expect(result.failed).toEqual(["milestone"]);
      expect(written.map((w) => w.kind).sort()).toEqual(["idle", "regular"]);
      expect(imageGenerator.calls.map((c) => c.prompt).sort()).toEqual(["idle-tag", "regular-tag"]);
    }
  });
});

describe("characterImage / 3 枚は同じシードで作る", () => {
  it("S0036_06 requests every image with the same seed, one image per request, differing only in tags", async () => {
    // GIVEN シードを受け付ける外部の画像プロバイダー
    const imageGenerator = fakeImageGenerator("stability-ai");
    const { input } = baseInput({ imageGenerator, seed: 777 });

    // WHEN 1 キャラの 3 枚を生成する
    await generateCharacterImages(input);

    // THEN 3 枚とも同じ seed、違うのはプロンプトの画像タグだけ
    expect(imageGenerator.calls).toHaveLength(3);
    expect(imageGenerator.calls.map((c) => c.seed)).toEqual([777, 777, 777]);
    expect(imageGenerator.calls.every((c) => c.count === 1)).toBe(true);
    expect(imageGenerator.calls.map((c) => c.prompt).sort()).toEqual([
      "idle-tag",
      "milestone-tag",
      "regular-tag",
    ]);
  });
});

// --- ローカル画像生成の作り方(論点 0045 / 0046。docs/integrations.md「ローカル画像生成の作り方」)---

const CANVAS = new Uint8Array([0xca, 0x4e]);

// 呼ばれた順に [1], [2], [3] を返す(1 枚目 = 待機画像の、縮小前の絵)。failAt 番目の呼び出しは失敗する
function fakeLocalGenerator(failAt = -1): ImageGenerator & { calls: ImageGenerationRequest[] } {
  const calls: ImageGenerationRequest[] = [];
  return {
    id: "local-sdcpp",
    calls,
    generateImages: async (req) => {
      calls.push(req);
      if (calls.length - 1 === failAt) throw new Error("sd.cpp exited with code 1");
      return [new Uint8Array([calls.length])];
    },
  };
}

// 縁が白、まん中の 1 画素が色つきの 3x3 の絵
function framedImage(center: readonly [number, number, number]): RgbaImage {
  const pixels = new Uint8Array(3 * 3 * 4).fill(255);
  pixels.set([...center, 255], 4 * 4);
  return { width: 3, height: 3, pixels };
}

function fakeLocalProcess(
  decodeScaled: (bytes: Uint8Array) => RgbaImage = (bytes) => framedImage([bytes[0]! * 60, 0, 0]),
) {
  const canvasSizes: [number, number][] = [];
  const decoded: Uint8Array[] = [];
  const encoded: RgbaImage[] = [];
  const savedSources: LocalIdleSource[] = [];
  const process: LocalImageProcess = {
    makeCanvas: (width, height) => {
      canvasSizes.push([width, height]);
      return CANVAS;
    },
    decodeScaled: (bytes) => {
      decoded.push(bytes);
      return decodeScaled(bytes);
    },
    encodePng: (image) => {
      encoded.push(image);
      return Uint8Array.from(image.pixels);
    },
    loadIdleSource: () => null,
    saveIdleSource: (source) => {
      savedSources.push(source);
    },
  };
  return { process, canvasSizes, decoded, encoded, savedSources };
}

function alphaOf(image: RgbaImage): number[] {
  const alphas: number[] = [];
  for (let i = 3; i < image.pixels.length; i += 4) alphas.push(image.pixels[i]!);
  return alphas;
}

describe("characterImage / 待機画像は白の下地から強さ 0.9・4 ステップで描く", () => {
  it("S0046_06 asks for the idle image from the canvas with strength 0.9 and 4 steps", async () => {
    // GIVEN providers.image = local-sdcpp
    const imageGenerator = fakeLocalGenerator();
    const local = fakeLocalProcess();
    const { input } = baseInput({ imageGenerator, local: local.process });

    // WHEN 待機画像を生成する
    await generateCharacterImages(input);

    // THEN 512x768 の下地を下絵に、強さ 0.9・ステップ数 4 で要求する
    expect(local.canvasSizes).toEqual([[512, 768]]);
    const idle = imageGenerator.calls[0]!;
    expect(idle.initImage).toBe(CANVAS);
    expect(idle.strength).toBe(0.9);
    expect(idle.steps).toBe(4);
    expect(idle.prompt).toBe(
      "solo, upper body, simple background, flat color, limited palette, 1girl, idle-tag, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 応援種別の画像は待機画像を下絵に強さ 0.65・8 ステップで描く", () => {
  it("S0046_07 asks for the cheer images from the unprocessed idle image with strength 0.65 and 8 steps", async () => {
    // GIVEN 待機画像を生成できた(縮小前の絵は [1])
    const imageGenerator = fakeLocalGenerator();
    const local = fakeLocalProcess();
    const { input } = baseInput({ imageGenerator, local: local.process });

    // WHEN regular / milestone の画像を生成する
    await generateCharacterImages(input);

    // THEN 縮小・後処理の前の待機画像を下絵に、強さ 0.65・ステップ数 8 で要求する
    const derived = imageGenerator.calls.slice(1);
    expect(derived).toHaveLength(2);
    for (const call of derived) {
      expect(Array.from(call.initImage!)).toEqual([1]);
      expect(call.strength).toBe(0.65);
      expect(call.steps).toBe(8);
    }
    expect(derived.map((call) => call.prompt)).toEqual([
      "solo, upper body, simple background, flat color, limited palette, 1girl, idle-tag, regular-tag, <lora:lcm-lora-sdv1-5:1>",
      "solo, upper body, simple background, flat color, limited palette, 1girl, idle-tag, milestone-tag, <lora:lcm-lora-sdv1-5:1>",
    ]);
  });
});

describe("characterImage / 待機画像を作れなければ応援種別の画像も作らない [異常系]", () => {
  it("S0046_08 makes and saves no image when the idle image fails", async () => {
    // GIVEN local-sdcpp で待機画像の生成が失敗する
    const imageGenerator = fakeLocalGenerator(0);
    const local = fakeLocalProcess();
    const { input, written } = baseInput({ imageGenerator, local: local.process });

    // WHEN 画像の工程を続ける
    const result = await generateCharacterImages(input);

    // THEN regular / milestone は生成せず、1 枚も保存しない
    expect(imageGenerator.calls).toHaveLength(1);
    expect(written).toEqual([]);
    expect(result.saved).toEqual([]);
    expect(result.failed.slice().sort()).toEqual(["idle", "milestone", "regular"]);
    expect(result.cancelled).toBe(false);
  });

  it("makes no image when the idle tag response is malformed", async () => {
    const imageGenerator = fakeLocalGenerator();
    const tagGenerator = fakeTagGenerator((kind) =>
      kind === "idle" ? "not json" : { tags: ["x"] },
    );
    const local = fakeLocalProcess();
    const { input, written } = baseInput({ imageGenerator, tagGenerator, local: local.process });

    const result = await generateCharacterImages(input);

    expect(imageGenerator.calls).toEqual([]);
    expect(written).toEqual([]);
    expect(result.failed.slice().sort()).toEqual(["idle", "milestone", "regular"]);
  });
});

describe("characterImage / 縮小してから、縁からつながる背景の色を透明にする", () => {
  it("S0046_09 scales the image first and then makes the background connected to the border transparent", async () => {
    // GIVEN sd.cpp が出した絵(縮小すると、縁が白でまん中が色つきの 3x3 になる)
    const imageGenerator = fakeLocalGenerator();
    const local = fakeLocalProcess();
    const { input, written } = baseInput({ imageGenerator, local: local.process });

    // WHEN 保存する
    await generateCharacterImages(input);

    // THEN sd.cpp が出した絵を縮小し、縮小した絵の縁からつながる背景だけが透明になったものを保存する
    expect(local.decoded.map((bytes) => Array.from(bytes))).toEqual([[1], [2], [3]]);
    expect(alphaOf(local.encoded[0]!)).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0]);
    expect(written.map((w) => w.kind)).toEqual(["idle", "regular", "milestone"]);
    expect(Array.from(written[0]!.bytes)).toEqual(Array.from(local.encoded[0]!.pixels));
  });

  it("keeps the unprocessed idle image, its tags and its colors for a later resume", async () => {
    const local = fakeLocalProcess();
    const { input } = baseInput({ imageGenerator: fakeLocalGenerator(), local: local.process });

    await generateCharacterImages(input);

    expect(local.savedSources).toHaveLength(1);
    expect(Array.from(local.savedSources[0]!.bytes)).toEqual([1]);
    expect(local.savedSources[0]!.tags).toBe("idle-tag");
    expect(local.savedSources[0]!.palette).toEqual([[60, 0, 0]]);
  });

  it("paints the cheer images with the colors of the idle image", async () => {
    const local = fakeLocalProcess();
    const { input } = baseInput({ imageGenerator: fakeLocalGenerator(), local: local.process });

    await generateCharacterImages(input);

    // まん中の色は待機 (60,0,0)・regular (120,0,0)・milestone (180,0,0)。保存では 3 枚とも待機の色になる
    expect(local.encoded).toHaveLength(3);
    for (const image of local.encoded) {
      expect(Array.from(image.pixels.slice(16, 20))).toEqual([60, 0, 0, 255]);
    }
  });
});

describe("characterImage / 背景が抜けなかった絵・全部抜けた絵もそのまま保存する [境界]", () => {
  it("S0046_15 saves an image whose pixels all became transparent without treating it as a failure", async () => {
    // GIVEN 背景を透明にすると不透明の画素が 1 つも残らない絵(1 色だけの絵)
    const plain: RgbaImage = { width: 2, height: 2, pixels: new Uint8Array(16).fill(255) };
    const local = fakeLocalProcess(() => plain);
    const { input, written } = baseInput({
      imageGenerator: fakeLocalGenerator(),
      local: local.process,
    });

    // WHEN 保存する
    const result = await generateCharacterImages(input);

    // THEN 失敗として扱わず、3 枚とも保存する
    expect(result.failed).toEqual([]);
    expect(written.map((w) => w.kind)).toEqual(["idle", "regular", "milestone"]);
    expect(alphaOf(local.encoded[0]!)).toEqual([0, 0, 0, 0]);
  });
});

describe("characterImage / 外部の画像プロバイダーにはローカルの作り方を当てない [否定]", () => {
  it("S0046_16 sends the plain image tags without canvas, init image or post-processing", async () => {
    // GIVEN providers.image が stability-ai(ローカルの後処理の手段が渡されていても)
    const imageGenerator = fakeImageGenerator("stability-ai");
    const local = fakeLocalProcess();
    const { input, written } = baseInput({ imageGenerator, local: local.process });

    // WHEN 1 キャラの 3 枚を生成して保存する
    await generateCharacterImages(input);

    // THEN 固定の語・下地・下絵・背景を透明にする処理・減色のどれも行わない
    expect(imageGenerator.calls.map((call) => call.prompt)).toEqual([
      "idle-tag",
      "regular-tag",
      "milestone-tag",
    ]);
    for (const call of imageGenerator.calls) {
      expect(call.initImage).toBeUndefined();
      expect(call.strength).toBeUndefined();
      expect(call.steps).toBeUndefined();
    }
    expect(local.canvasSizes).toEqual([]);
    expect(local.decoded).toEqual([]);
    expect(local.encoded).toEqual([]);
    expect(local.savedSources).toEqual([]);
    expect(written.map((w) => Array.from(w.bytes))).toEqual([[8], [11], [13]]);
  });
});

describe("characterImage / 外部の画像プロバイダーでは画像タグの要求を変えない [否定]", () => {
  it("S0049_03 asks for the appearance only for local-sdcpp and keeps the request as before for an external provider", async () => {
    // GIVEN providers.image が stability-ai の場合と、local-sdcpp の場合
    const externalTags = fakeTagGenerator();
    const localTags = fakeTagGenerator();
    const external = baseInput({
      tagGenerator: externalTags,
      imageGenerator: fakeImageGenerator("stability-ai"),
      local: fakeLocalProcess().process,
    });
    const local = baseInput({
      tagGenerator: localTags,
      imageGenerator: fakeLocalGenerator(),
      local: fakeLocalProcess().process,
    });

    // WHEN 3 枚の画像タグを要求する
    await generateCharacterImages(external.input);
    await generateCharacterImages(local.input);

    // THEN 外部の要求は今までの形のまま(訊き分けをしない)。local-sdcpp だけが見た目・表情とポーズを訊き分ける
    for (const call of externalTags.calls) {
      expect(call.prompt).toContain("表情・ポーズ・雰囲気");
      expect(call.prompt).not.toContain("髪の色");
      expect(call.prompt).not.toContain("表情とポーズだけ");
    }
    expect(localTags.calls.map((call) => call.prompt.includes("髪の色"))).toEqual([
      true,
      false,
      false,
    ]);
    expect(localTags.calls.map((call) => call.prompt.includes("表情とポーズだけ"))).toEqual([
      false,
      true,
      true,
    ]);
  });
});
