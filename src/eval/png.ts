// png: 計測ドライバが画像の画素を読み書きするための PNG の読み書き(論点 0045)。
//
// なぜ自前で書くか:背景を抜く処理と減色は画素を読まないとできないが、計測ドライバは Electron の外
// (tsx)で動くので nativeImage が使えない。PNG のライブラリを足すと新規依存の審査が要る
// (@.claude/rules/security-rules.md)。sd.cpp が出す形だけ読めれば足りるので、Node 標準の zlib で書く。
// 対象は 8 ビットの RGB / RGBA・インターレースなしだけ。それ以外は例外にする(黙って壊れた画素を返さない)。
// アプリ側(src/agent・src/main)からは使わない。

import { crc32, deflateSync, inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  // 1 画素 4 バイト(R, G, B, A)を左上から行ごとに並べたもの
  pixels: Uint8Array;
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const RGBA_BYTES = 4;
const OPAQUE = 255;

// PNG の仕様のフィルター 4(Paeth)。左・上・左上のうち予測値に最も近いものを選ぶ
function computePaeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < SIGNATURE.length || !SIGNATURE.every((b, i) => buffer[i] === b)) {
    throw new Error("PNG ではない");
  }

  let width = 0;
  let height = 0;
  let colorType = -1;
  const dataParts: Buffer[] = [];
  let offset = SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9]!;
      if (body[8] !== BIT_DEPTH || body[12] !== 0) {
        throw new Error("PNG: 8 ビット・インターレースなしだけ読める");
      }
    } else if (type === "IDAT") {
      dataParts.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + size;
  }
  if (colorType !== COLOR_TYPE_RGB && colorType !== COLOR_TYPE_RGBA) {
    throw new Error("PNG: RGB / RGBA だけ読める");
  }

  const channels = colorType === COLOR_TYPE_RGBA ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(dataParts));
  if (raw.length < (stride + 1) * height) throw new Error("PNG: 画素が足りない");

  const pixels = new Uint8Array(width * height * RGBA_BYTES);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      const value = raw[rowStart + 1 + i]!;
      if (filter === 0) row[i] = value;
      else if (filter === 1) row[i] = value + left;
      else if (filter === 2) row[i] = value + up;
      else if (filter === 3) row[i] = value + ((left + up) >> 1);
      else if (filter === 4) row[i] = value + computePaeth(left, up, upLeft);
      else throw new Error(`PNG: 知らないフィルター ${filter}`);
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * RGBA_BYTES;
      pixels[target] = row[x * channels]!;
      pixels[target + 1] = row[x * channels + 1]!;
      pixels[target + 2] = row[x * channels + 2]!;
      pixels[target + 3] = channels === 4 ? row[x * channels + 3]! : OPAQUE;
    }
    previous = row;
  }
  return { width, height, pixels };
}

function buildChunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

// いつも RGBA で書く(透明を持つ画像を書くのが目的)。フィルターは使わない(大きさより単純さを取る)
export function encodePng(image: RgbaImage): Uint8Array {
  const stride = image.width * RGBA_BYTES;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw.set(image.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = BIT_DEPTH;
  header[9] = COLOR_TYPE_RGBA;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(SIGNATURE),
      buildChunk("IHDR", header),
      buildChunk("IDAT", deflateSync(raw)),
      buildChunk("IEND", new Uint8Array()),
    ]),
  );
}
