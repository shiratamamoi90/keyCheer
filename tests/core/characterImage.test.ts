// core/characterImage: キャラ画像の画像タグの要求の組み立て・応答のパース・縮小後の大きさ。純粋関数のみ。
// 要件: docs/integrations.md「画像タグの要求」/ docs/pool-generation.md「生成でキャラ画像も作る」(論点 0036)

import { describe, it, expect } from "vitest";
import {
  applyBackgroundRemoval,
  applyImagePalette,
  applyPersonProbabilityMask,
  applyRedBlueSwap,
  buildImageTagPrompt,
  buildImageTagText,
  buildLocalImagePrompt,
  buildLocalImageTagPrompt,
  buildSegmentationInput,
  computeImagePalette,
  computeImageSize,
  computePersonProbability,
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
  it("S0067_01 puts the fixed tags, the image tags and the LoRA in this order", () => {
    // GIVEN 待機画像の画像タグが `1girl, long hair`
    // WHEN 待機画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("1girl, long hair");

    // THEN 固定の語、画像タグ、LoRA の指定の順になる
    expect(prompt).toBe(
      "solo, upper body, simple background, 1girl, long hair, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 人物の語が画像タグに無ければ 1girl を足す [境界]", () => {
  it("S0067_02 adds 1girl right after the fixed tags when no person tag is present", () => {
    // GIVEN 待機画像の画像タグが `long hair`
    // WHEN 待機画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("long hair");

    // THEN 固定の語の直後に 1girl が入る
    expect(prompt).toBe(
      "solo, upper body, simple background, 1girl, long hair, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 通常の応援の画像のプロンプトは待機画像の画像タグ・表情の画像タグ・通常のポーズの語の順に組み立てる", () => {
  it("S0067_03 appends the expression and the regular pose to the idle tags", () => {
    // GIVEN 待機画像の画像タグが `1girl, long hair`、regular の画像の画像タグ(表情)が `smile`
    // WHEN regular の画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("1girl, long hair", { kind: "regular", tags: "smile" });

    // THEN 待機画像の画像タグ・表情・通常のポーズの語の順に続く
    expect(prompt).toBe(
      "solo, upper body, simple background, 1girl, long hair, smile, fist pump, pointing at viewer, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 節目の応援の画像のプロンプトには節目のポーズの語を足す", () => {
  it("S0067_04 appends the expression and the milestone pose to the idle tags", () => {
    // GIVEN 待機画像の画像タグが `1girl, long hair`、milestone の画像の画像タグ(表情)が `grin`
    // WHEN milestone の画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("1girl, long hair", { kind: "milestone", tags: "grin" });

    // THEN 節目のポーズの語が続く
    expect(prompt).toBe(
      "solo, upper body, simple background, 1girl, long hair, grin, arms up, jumping, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / アプリが足す語に色の語を含めない [否定]", () => {
  it("S0067_05 adds neither flat color nor limited palette, and keeps them only when the image tags have them", () => {
    // GIVEN 画像タグに色の語が無い 3 枚と、画像タグに `flat color` がある待機画像
    // WHEN 3 枚それぞれのプロンプトを組み立てる
    const prompts = [
      buildLocalImagePrompt("1girl, long hair"),
      buildLocalImagePrompt("1girl, long hair", { kind: "regular", tags: "smile" }),
      buildLocalImagePrompt("1girl, long hair", { kind: "milestone", tags: "grin" }),
    ];
    const withColorTag = buildLocalImagePrompt("1girl, flat color");

    // THEN アプリが足す語に色の語は無い。画像タグにあればそのまま 1 回だけ残る
    for (const prompt of prompts) {
      expect(prompt).not.toContain("flat color");
      expect(prompt).not.toContain("limited palette");
    }
    expect(withColorTag).toBe(
      "solo, upper body, simple background, 1girl, flat color, <lora:lcm-lora-sdv1-5:1>",
    );
  });
});

describe("characterImage / 待機画像のプロンプトにポーズの語を足さない [否定]", () => {
  it("S0062_03 adds no pose word to the idle prompt", () => {
    // GIVEN 待機画像の画像タグが `1girl, long hair`
    // WHEN 待機画像のプロンプトを組み立てる
    const prompt = buildLocalImagePrompt("1girl, long hair");

    // THEN ポーズの語を含まない
    for (const word of ["fist pump", "pointing at viewer", "arms up", "jumping"]) {
      expect(prompt, word).not.toContain(word);
    }
  });
});

describe("characterImage / 応援種別の画像にほかの応援種別のポーズの語と演出の語を足さない [否定]", () => {
  it("S0062_04 keeps the pose of the other cheer type and the effects out of the prompt", () => {
    // GIVEN 待機画像の画像タグと、regular / milestone の画像の画像タグ(表情)
    // WHEN regular と milestone の画像のプロンプトを組み立てる
    const regular = buildLocalImagePrompt("1girl, long hair", { kind: "regular", tags: "smile" });
    const milestone = buildLocalImagePrompt("1girl, long hair", {
      kind: "milestone",
      tags: "grin",
    });

    // THEN ほかの応援種別のポーズの語と、演出の語を含まない
    expect(regular).not.toContain("arms up");
    expect(regular).not.toContain("jumping");
    expect(milestone).not.toContain("fist pump");
    expect(milestone).not.toContain("pointing at viewer");
    for (const prompt of [regular, milestone]) {
      expect(prompt).not.toContain("sparkle");
      expect(prompt).not.toContain("confetti");
    }
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

describe("characterImage / 待機画像がすべて透明なら、応援種別の画像の色を置き換えない [境界]", () => {
  it("S0089_01 keeps every opaque color of the cheer-type image when the idle image has no opaque pixel", () => {
    // GIVEN 待機画像がすべて透明(不透明の色が 1 つも無い)。応援種別の画像は 9 色
    const idle = makeImage(["rr"], { r: RED });
    idle.pixels[3] = 0;
    idle.pixels[7] = 0;
    const derived = makeImage(["abcdefghi"], NINE_COLORS);
    const before = Uint8Array.from(derived.pixels);

    // WHEN 応援種別の画像を待機画像の色で塗る
    const painted = applyImagePalette(derived, computeImagePalette(idle));

    // THEN 色は置き換えず、9 色のまま(7 色の上限を当てない)。渡した絵も変えない
    expect([...painted.pixels]).toEqual([...before]);
    expect(opaqueColorsOf(painted)).toHaveLength(9);
    expect([...derived.pixels]).toEqual([...before]);
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

describe("characterImage / 応援種別の画像の画像タグの要求は表情だけを訊く", () => {
  it("S0062_05 shows the messages of that cheer type and asks only for the expression", () => {
    // GIVEN local-sdcpp、regular と milestone のセリフを持つプール
    const pool = makePool();

    // WHEN regular の画像の画像タグの要求を組み立てる
    const prompt = buildLocalImageTagPrompt(character, "regular", pool);

    // THEN regular のセリフを示して表情だけを 1〜2 個訊き、ポーズ・髪・目・服は書かないよう指示する。milestone のセリフは含まない
    for (const key of ALL_BUCKET_KEYS.filter((k) => k.includes("_regular_"))) {
      expect(prompt).toContain(`R:${key}`);
    }
    expect(prompt).not.toContain("M:");
    expect(prompt).toContain("表情だけ");
    expect(prompt).toContain("1〜2 個");
    expect(prompt).toContain("ポーズ・髪・目・服は書かないでください");
    expect(prompt).not.toContain("表情とポーズ");
  });
});

// --- 人物の切り抜き(論点 0063)---

const SEGMENTATION_SIZE = 320;

describe("characterImage / 人物を切り抜くモデルの入力は 320x320 に縮めて正規化した絵にする", () => {
  it("S0063_01 scales to 320x320 with aligned corners, divides by the max value and normalizes each channel first", () => {
    // GIVEN 左の列が黒、右の列が (200, 100, 50) の 2x2 の絵(縮小の前の絵の代わり)
    const pixels = new Uint8Array(2 * 2 * 4);
    for (const offset of [4, 12]) pixels.set([200, 100, 50, 255], offset);
    for (const offset of [0, 8]) pixels.set([0, 0, 0, 255], offset);
    const image: RgbaImage = { width: 2, height: 2, pixels };
    const before = Uint8Array.from(pixels);

    // WHEN 人物を切り抜くモデルへの入力を作る
    const input = buildSegmentationInput(image);

    // THEN 1 x 3 x 320 x 320 を R・G・B の順にチャンネルを先にして並べる。両端は元の両端の画素の値(全部の値の最大 200 で割り、平均を引いて標準偏差で割る)
    const plane = SEGMENTATION_SIZE * SEGMENTATION_SIZE;
    expect(input).toHaveLength(3 * plane);
    const last = SEGMENTATION_SIZE - 1;
    expect(input[0]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    expect(input[last]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(input[plane + last]).toBeCloseTo((0.5 - 0.456) / 0.224, 5);
    expect(input[2 * plane + last]).toBeCloseTo((0.25 - 0.406) / 0.225, 5);
    // 双線形補間:x = 1 は右の列から 1/319 の重み
    expect(input[1]).toBeCloseTo(((1 / 319) * 1 - 0.485) / 0.229, 5);
    // 引数の絵を書き換えない
    expect(Array.from(image.pixels)).toEqual(Array.from(before));
  });
});

describe("characterImage / 人物である確率が 0.5 未満の画素を透明にする", () => {
  it("S0063_02 stretches the output to 0..1, resizes it to the saved size and makes pixels under 0.5 transparent", () => {
    // GIVEN モデルの最初の出力:左の端の列が -2、右の端の列が 6、ほかが 2(引き伸ばすと 0 / 1 / 0.5)
    const output = new Float32Array(SEGMENTATION_SIZE * SEGMENTATION_SIZE).fill(2);
    for (let y = 0; y < SEGMENTATION_SIZE; y++) {
      output[y * SEGMENTATION_SIZE] = -2;
      output[y * SEGMENTATION_SIZE + SEGMENTATION_SIZE - 1] = 6;
    }
    // 縮小した絵:3x1。まん中の画素は半透明
    const small: RgbaImage = {
      width: 3,
      height: 1,
      pixels: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 255]),
    };

    // WHEN 保存する絵の背景を透明にする
    const probability = computePersonProbability(output, small.width, small.height);
    const masked = applyPersonProbabilityMask(small, probability);

    // THEN 左(0)は透明、まん中(0.5)と右(1)は完全に不透明。色は変えない
    expect(Array.from(probability)).toEqual([0, 0.5, 1]);
    expect(Array.from(masked.pixels)).toEqual([0, 0, 0, 0, 40, 50, 60, 255, 70, 80, 90, 255]);
  });

  it("treats an output whose values are all the same as probability 0", () => {
    const output = new Float32Array(SEGMENTATION_SIZE * SEGMENTATION_SIZE).fill(3);
    expect(Array.from(computePersonProbability(output, 2, 1))).toEqual([0, 0]);
  });
});

describe("characterImage / 人物と判定した画素は背景の色に近くても透明にしない [否定]", () => {
  it("S0063_03 keeps pixels judged as the person opaque even when they match the border color", () => {
    // GIVEN 縁まで白い服が届いた 3x3 の絵(全部が縁の色と同じ)で、どの画素も人物である確率が 0.5 以上
    const small: RgbaImage = { width: 3, height: 3, pixels: new Uint8Array(3 * 3 * 4).fill(255) };
    const probability = new Float32Array(9).fill(0.9);

    // WHEN 背景を透明にする
    const masked = applyPersonProbabilityMask(small, probability);

    // THEN 色で抜くやり方を重ねず、どの画素も不透明のまま
    const alphas = Array.from(masked.pixels).filter((_, i) => i % 4 === 3);
    expect(alphas).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 255]);
  });
});
