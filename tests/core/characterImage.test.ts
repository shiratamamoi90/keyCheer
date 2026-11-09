// core/characterImage: キャラ画像の画像タグの要求の組み立て・応答のパース・縮小後の大きさ。純粋関数のみ。
// 要件: docs/integrations.md「画像タグの要求」/ docs/pool-generation.md「生成でキャラ画像も作る」(論点 0036)

import { describe, it, expect } from "vitest";
import {
  buildImageTagPrompt,
  buildImageTagText,
  computeImageSize,
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
