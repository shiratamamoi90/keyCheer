// eval/png: 計測ドライバが画像の画素を読み書きするための PNG の読み書き(論点 0045)。
// 対象は sd.cpp が出す 8 ビットの RGB / RGBA・インターレースなしだけ。

import { deflateSync, crc32 } from "node:zlib";
import { describe, it, expect } from "vitest";
import { decodePng, encodePng } from "../../src/eval/png.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function makeChunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

// 2x2 の RGB。1 行目はフィルター Sub、2 行目はフィルター Up で書く
function makeRgbPngWithFilters(): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8; // ビット深度
  header[9] = 2; // RGB
  const rows = Buffer.from([
    // Sub: 2 画素目は左との差。(10,20,30) → (15,25,35)
    1, 10, 20, 30, 5, 5, 5,
    // Up: 上の行との差。(11,22,33) と (15,25,36)
    2, 1, 2, 3, 0, 0, 1,
  ]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(SIGNATURE),
      makeChunk("IHDR", header),
      makeChunk("IDAT", deflateSync(rows)),
      makeChunk("IEND", new Uint8Array()),
    ]),
  );
}

describe("png", () => {
  it("decodes what it encoded, including transparency", () => {
    const image = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 255, 0, 128, 255, 0]),
    };
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it("decodes an RGB image with Sub and Up filters as opaque RGBA", () => {
    const image = decodePng(makeRgbPngWithFilters());
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect([...image.pixels]).toEqual([
      10, 20, 30, 255, 15, 25, 35, 255, 11, 22, 33, 255, 15, 25, 36, 255,
    ]);
  });

  it("throws on bytes that are not a PNG", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow();
  });
});
