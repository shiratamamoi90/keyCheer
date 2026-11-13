// core/characterImage: キャラ画像の画像タグの要求の組み立て・応答のパース・縮小後の大きさ。純粋関数のみ。
// 要件: docs/integrations.md「画像タグの要求」/ docs/pool-generation.md「生成でキャラ画像も作る」(論点 0036)

import { describe, it, expect } from "vitest";
import {
  applyBackgroundRemoval,
  applyImagePalette,
  applyRedBlueSwap,
  buildImageTagPrompt,
  buildImageTagText,
  buildLocalImagePrompt,
  buildLocalImageTagPrompt,
  computeImagePalette,
  computeImageSize,
  type RgbaImage,
} from "../../src/core/characterImage.js";
import { ALL_BUCKET_KEYS, type MessagePool } from "../../src/core/messagePool.js";

const character = { name: "チアちゃん", personality: "元気いっぱいで語尾に「だよ!」" };

// regular のバケットの文は "R:"、milestone の文は "M:" で始める(どの種別の文が入ったかを見分けるため)
function makePool(): MessagePool {
  const buckets = Object.fromEntries(
    ALL_BUCKET_KEYS.map((key) => [
      key,
      [{ id: `${key}-000`, text: key.includes("_milestone_") ? `M:${key}` : `R:${key}` }],
    ]),
  ) as MessagePool["buckets"];
  return { characterId: "c", version: 1, buckets };
}

describe("characterImage / 待機画像の要求にセリフを入れない [否定]", () => {
  it("S0036_02 builds the idle tag prompt without any pool message", () => {
    // GIVEN プールのあるキャラクター
    const pool = makePool();

    // WHEN 待機画像の画像タグの要求を組み立てる
    const prompt = buildImageTagPrompt(character, "idle", pool);

    // THEN プールのセリフを 1 文も含まない(プロフィールは含む)
    expect(prompt).not.toMatch(/R:|M:/);
    expect(prompt).toContain("チアちゃん");
    expect(prompt).toContain("元気いっぱいで語尾に「だよ!」");
  });
});

describe("characterImage / 応援種別の画像の要求にほかの応援種別のセリフを入れない [否定]", () => {
  it("S0036_03 keeps regular messages out of the milestone prompt and vice versa", () => {
    // GIVEN regular と milestone のセリフを持つプール
    const pool = makePool();

    // WHEN 応援種別ごとの画像タグの要求を組み立てる
    const milestonePrompt = buildImageTagPrompt(character, "milestone", pool);
    const regularPrompt = buildImageTagPrompt(character, "regular", pool);

    // THEN ほかの応援種別のセリフを含まない
    expect(milestonePrompt).not.toContain("R:");
    expect(milestonePrompt).toContain("M:fast_milestone_night");
    expect(regularPrompt).not.toContain("M:");
    expect(regularPrompt).toContain("R:slow_regular_morning");
  });
});

describe("characterImage / 画像タグを連結してプロンプトにする", () => {
  it("S0036_04 trims, drops empty elements and joins the rest with ', '", () => {
    // GIVEN 応答 { tags: ["smiling", " ", "raising fist"] }
    const raw = { tags: ["smiling", " ", "raising fist"] };

    // WHEN パースする
    const text = buildImageTagText(raw);

    // THEN 空を捨てて ", " で連結する
    expect(text).toBe("smiling, raising fist");
  });
});

describe("characterImage / 縮小して PNG で保存する [境界]", () => {
  it("S0036_15 fits the image into 256x384 keeping the aspect ratio, without upscaling", () => {
    // GIVEN プロバイダーが返す大きさ / WHEN 保存する大きさを決める / THEN 縦横比を保って 256x384 に収める
    expect(computeImageSize(512, 768)).toEqual({ width: 256, height: 384 });
    expect(computeImageSize(1024, 1024)).toEqual({ width: 256, height: 256 });
    // 収まる画像は拡大しない
    expect(computeImageSize(200, 300)).toEqual({ width: 200, height: 300 });
  });
});

// --- ローカル画像生成の作り方(論点 0045 / 0046。docs/integrations.md「ローカル画像生成の作り方」)---

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [200, 0, 0];
const BLUE: Rgb = [0, 0, 200];

// 文字 1 つ = 1 画素の絵から、不透明の画像を作る
function makeImage(rows: readonly string[], colors: Readonly<Record<string, Rgb>>): RgbaImage {
  const width = rows[0]!.length;
  const pixels = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const [r, g, b] = colors[ch]!;
      pixels.set([r, g, b, 255], (y * width + x) * 4);
    });
  });
  return { width, height: rows.length, pixels };
}

function alphaOf(image: RgbaImage): number[] {
  const alphas: number[] = [];
  for (let i = 3; i < image.pixels.length; i += 4) alphas.push(image.pixels[i]!);
  return alphas;
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

// 9 色の帯(どの色も互いに遠い)
const NINE_COLORS: Readonly<Record<string, Rgb>> = {
  a: [0, 0, 0],
  b: [250, 0, 0],
  c: [0, 250, 0],
  d: [0, 0, 250],
  e: [250, 250, 0],
  f: [0, 250, 250],
  g: [250, 0, 250],
  h: [120, 120, 120],
  i: [250, 250, 250],
};

describe("characterImage / プロンプトは固定の語・画像タグ・LoRA の指定の順に組み立てる", () => {
  it("S0046_01 puts the fixed tags, the image tags and the LoRA in this order", () => {
    // GIVEN 待機画像の画像タグが `1girl, long hair`
    // WHEN 待機画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("1girl, long hair");

    // THEN 固定の語、画像タグ、LoRA の指定の順になる
    expect(prompt).toBe(
      "solo, upper body, simple background, flat color, limited palette, 1girl, long hair, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 人物の語が画像タグに無ければ 1girl を足す [境界]", () => {
  it("S0046_02 adds 1girl right after the fixed tags when no person tag is present", () => {
    // GIVEN 待機画像の画像タグが `long hair`
    // WHEN 待機画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("long hair");

    // THEN 固定の語の直後に 1girl が入る
    expect(prompt).toBe(
      "solo, upper body, simple background, flat color, limited palette, 1girl, long hair, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 応援種別の画像のプロンプトは待機画像の画像タグにその画像の画像タグを足す", () => {
  it("S0046_03 appends the tags of the cheer image to the idle tags", () => {
    // GIVEN 待機画像の画像タグが `1girl, long hair`、regular の画像の画像タグが `smile, waving`
    // WHEN regular の画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("1girl, long hair", "smile, waving");

    // THEN 待機画像の画像タグの後ろに、その画像の画像タグが続く
    expect(prompt).toBe(
      "solo, upper body, simple background, flat color, limited palette, 1girl, long hair, smile, waving, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 背景に近い色でも縁からつながらない所は透明にしない [否定]", () => {
  it("S0046_10 keeps a background-colored pixel that is enclosed by other colors", () => {
    // GIVEN 背景の色(白)の画素が、赤に囲まれていて縁からたどれない
    const image = makeImage(["wwwww", "wrrrw", "wrwrw", "wrrrw", "wwwww"], { w: WHITE, r: RED });

    // WHEN 背景を透明にする
    const cut = applyBackgroundRemoval(image);

    // THEN 囲まれた白は不透明のまま。縁からつながる白は透明になる
    expect(alphaOf(cut)[12]).toBe(255);
    expect(alphaOf(cut)[0]).toBe(0);
  });
});

describe("characterImage / 保存する絵は 7 色以下で、半透明の画素を持たない", () => {
  it("S0046_11 reduces the opaque pixels to at most 7 colors with no translucent pixel", () => {
    // GIVEN 背景を透明にした絵に、不透明の画素の色が 9 色ある
    const image = applyBackgroundRemoval(
      makeImage(["wwwwwwwwwww", "wabcdefghiw", "wwwwwwwwwww"], {
        ...NINE_COLORS,
        w: [128, 64, 200],
      }),
    );
    expect(opaqueColorsOf(image)).toHaveLength(9);

    // WHEN 色を減らす
    const reduced = applyImagePalette(image, computeImagePalette(image));

    // THEN 不透明の色は 7 色以下。どの画素も完全に透明か完全に不透明
    expect(opaqueColorsOf(reduced).length).toBeLessThanOrEqual(7);
    expect(opaqueColorsOf(reduced).length).toBeGreaterThan(0);
    expect(alphaOf(reduced).every((alpha) => alpha === 0 || alpha === 255)).toBe(true);
    expect(alphaOf(reduced)).toEqual(alphaOf(image));
  });
});

describe("characterImage / 不透明の色が 7 色以下ならその色のまま保存する [境界]", () => {
  it("S0046_12 leaves the colors untouched when there are 7 or fewer", () => {
    // GIVEN 不透明の画素の色が 3 色(うち 2 色はごく近い)
    const image = makeImage(["abc"], { a: [200, 0, 0], b: [201, 0, 0], c: [0, 0, 200] });

    // WHEN 色を減らす
    const reduced = applyImagePalette(image, computeImagePalette(image));

    // THEN 色は変わらない
    expect([...reduced.pixels]).toEqual([...image.pixels]);
  });
});

describe("characterImage / 応援種別の画像は待機画像の色だけで塗る", () => {
  it("S0046_13 paints each opaque pixel with the nearest color of the idle image", () => {
    // GIVEN 待機画像の色が 赤(200,0,0)と 青(0,0,200)
    const idle = makeImage(["rrbb"], { r: RED, b: BLUE });
    const derived = makeImage(["abcd"], {
      a: [180, 20, 20],
      b: [220, 5, 5],
      c: [20, 20, 220],
      d: [90, 90, 140],
    });

    // WHEN 応援種別の画像を待機画像の色で塗る
    const painted = applyImagePalette(derived, computeImagePalette(idle));

    // THEN どの画素も、待機画像の色のうちいちばん近い色になる
    expect([...painted.pixels]).toEqual([
      200, 0, 0, 255, 200, 0, 0, 255, 0, 0, 200, 255, 0, 0, 200, 255,
    ]);
  });
});

describe("characterImage / 同じ絵からは同じ絵が保存される", () => {
  it("S0046_14 gives the same pixels when the same image is processed twice", () => {
    // GIVEN 同じ絵
    const source = makeImage(["wwwwwwwwwww", "wabcdefghiw", "wwwwwwwwwww"], {
      ...NINE_COLORS,
      w: [128, 64, 200],
    });
    const before = [...source.pixels];

    // WHEN 背景を透明にして色を減らす処理を 2 回行う
    const run = (): number[] => {
      const cut = applyBackgroundRemoval(source);
      return [...applyImagePalette(cut, computeImagePalette(cut)).pixels];
    };

    // THEN 2 回の結果は画素ごとに一致し、もとの絵は書き換わらない
    expect(run()).toEqual(run());
    expect([...source.pixels]).toEqual(before);
  });
});

describe("characterImage / 色の並びの入れ替え", () => {
  it("swaps the first and the third channel of every pixel without touching the input", () => {
    const image: RgbaImage = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([50, 100, 200, 255, 1, 2, 3, 0]),
    };

    const swapped = applyRedBlueSwap(image);

    expect([...swapped.pixels]).toEqual([200, 100, 50, 255, 3, 2, 1, 0]);
    expect([...image.pixels]).toEqual([50, 100, 200, 255, 1, 2, 3, 0]);
  });
});

describe("characterImage / 待機画像の画像タグの要求は見た目を訊く", () => {
  it("S0049_01 asks for the appearance and includes no pool message", () => {
    // GIVEN local-sdcpp、プールのあるキャラクター
    const pool = makePool();

    // WHEN 待機画像の画像タグの要求を組み立てる
    const prompt = buildLocalImageTagPrompt(character, "idle", pool);

    // THEN 人物の語・髪の色・髪型・目の色・服装を訊く。セリフは 1 文も含まない
    for (const word of ["1girl", "1boy", "髪の色", "髪型", "目の色", "服装"]) {
      expect(prompt, word).toContain(word);
    }
    expect(prompt).toContain("チアちゃん");
    expect(prompt).not.toContain("R:");
    expect(prompt).not.toContain("M:");
  });
});

describe("characterImage / 応援種別の画像の画像タグの要求は表情とポーズだけを訊く", () => {
  it("S0049_02 shows the messages of that cheer type and asks only for the expression and the pose", () => {
    // GIVEN local-sdcpp、regular と milestone のセリフを持つプール
    const pool = makePool();

    // WHEN regular の画像の画像タグの要求を組み立てる
    const prompt = buildLocalImageTagPrompt(character, "regular", pool);

    // THEN regular のセリフを示して表情とポーズを訊き、髪・目・服は書かないよう指示する。milestone のセリフは含まない
    for (const key of ALL_BUCKET_KEYS.filter((k) => k.includes("_regular_"))) {
      expect(prompt).toContain(`R:${key}`);
    }
    expect(prompt).not.toContain("M:");
    expect(prompt).toContain("表情とポーズだけ");
    expect(prompt).toContain("髪・目・服は書かないでください");
    expect(prompt).not.toContain("髪型");
  });
});
