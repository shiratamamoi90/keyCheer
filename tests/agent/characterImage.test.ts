// agent/characterImage: 画像タグの要求 → 同じシードで画像 3 枚 → 書き出し、のオーケストレーション。
// 要件: docs/integrations.md「画像」「画像タグの要求」(論点 0036)
// テキスト・画像のプロバイダーと書き出しは注入。実 HTTP も子プロセスも起こさない。

import { describe, it, expect } from "vitest";
import { generateCharacterImages } from "../../src/agent/characterImage.js";
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

function fakeImageGenerator(): ImageGenerator & { calls: ImageGenerationRequest[] } {
  const calls: ImageGenerationRequest[] = [];
  return {
    id: "local-sdcpp",
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
    // GIVEN シードを受け付ける画像プロバイダー
    const imageGenerator = fakeImageGenerator();
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
